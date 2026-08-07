"""Convert a Meta MMS TTS checkpoint into the layout transformers.js loads.

Ongea runs synthesis in the browser, so every language needs ONNX weights and a
fast-tokenizer file. Most MMS languages already have both published under the
Xenova namespace on the Hub and are fetched from there at runtime; Swahili does
not, so it is converted here and served from `public/models` instead.

This is a build-time tool. Nothing in the shipped app runs Python.

    pip install torch transformers onnx onnxruntime
    python tools/export_onnx_voice.py facebook/mms-tts-swh public/models/mms-tts-swh

Re-run it only when adding a language that has no published conversion.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch
from torch import nn

# transformers.js reads exactly these names off the graph.
INPUT_NAMES = ["input_ids", "attention_mask"]
OUTPUT_NAMES = ["waveform", "spectrogram"]
OPSET = 17


class ExportableVits(nn.Module):
    """Pins the forward signature to the two inputs transformers.js supplies."""

    def __init__(self, model: nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor):
        outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
        return outputs.waveform, outputs.spectrogram


def build_tokenizer_json(vocab: dict[str, int], pad_token: str, unk_token: str) -> dict:
    """Rebuild the slow VitsTokenizer as a `tokenizers` JSON file.

    The Python tokenizer normalises in code; the browser needs those same steps
    expressed as normalizer rules. In order: lowercase, drop every character the
    vocabulary has no symbol for, strip the ends, then interleave the pad token
    between characters, which is what `add_blank` does on the Python side.
    """
    unk_id = vocab[unk_token]
    speakable = "".join(sorted(token for token in vocab if len(token) == 1))
    escaped = speakable.replace("\\", "\\\\").replace("]", "\\]").replace("^", "\\^").replace("-", "\\-")

    return {
        "version": "1.0",
        "truncation": None,
        "padding": None,
        "added_tokens": [
            {
                "id": unk_id,
                "content": unk_token,
                "single_word": False,
                "lstrip": False,
                "rstrip": False,
                "normalized": False,
                "special": True,
            }
        ],
        "normalizer": {
            "type": "Sequence",
            "normalizers": [
                {"type": "Lowercase"},
                {"type": "Replace", "pattern": {"Regex": f"[^{escaped}]"}, "content": ""},
                {"type": "Strip", "strip_left": True, "strip_right": True},
                # Matches before every character and again at the end, so the
                # blank lands between each pair and after the last one.
                {"type": "Replace", "pattern": {"Regex": "(?=.)|(?<!^)$"}, "content": pad_token},
            ],
        },
        "pre_tokenizer": {"type": "Split", "pattern": {"Regex": ""}, "behavior": "Isolated", "invert": False},
        "post_processor": None,
        "decoder": None,
        "model": {"vocab": vocab},
    }


def export(model_id: str, destination: Path, quantize: bool) -> None:
    from transformers import AutoTokenizer, VitsModel

    destination.mkdir(parents=True, exist_ok=True)
    onnx_dir = destination / "onnx"
    onnx_dir.mkdir(exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = VitsModel.from_pretrained(model_id)
    model.eval()

    print(f"exporting {model_id} at opset {OPSET}")
    sample = tokenizer("habari", return_tensors="pt")
    fp32_path = onnx_dir / "model.onnx"

    torch.onnx.export(
        ExportableVits(model),
        (sample["input_ids"], sample["attention_mask"]),
        str(fp32_path),
        input_names=INPUT_NAMES,
        output_names=OUTPUT_NAMES,
        dynamic_axes={
            "input_ids": {0: "text_batch_size", 1: "sequence_length"},
            "attention_mask": {0: "text_batch_size", 1: "sequence_length"},
            "waveform": {0: "text_batch_size", 1: "n_samples"},
            "spectrogram": {0: "text_batch_size", 2: "num_bins"},
        },
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
    )
    print(f"  wrote {fp32_path} ({fp32_path.stat().st_size / 1e6:.1f} MB)")

    if quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantized_path = onnx_dir / "model_quantized.onnx"
        quantize_dynamic(
            model_input=str(fp32_path),
            model_output=str(quantized_path),
            weight_type=QuantType.QUInt8,
            per_channel=False,
            reduce_range=False,
            extra_options={"MatMulConstBOnly": True},
        )
        print(f"  wrote {quantized_path} ({quantized_path.stat().st_size / 1e6:.1f} MB)")

    model.config.to_json_file(destination / "config.json")

    vocab = tokenizer.get_vocab()
    tokenizer_json = build_tokenizer_json(vocab, tokenizer.pad_token, tokenizer.unk_token)
    (destination / "tokenizer.json").write_text(
        json.dumps(tokenizer_json, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    tokenizer.save_pretrained(destination / "_slow")
    shutil.copy(destination / "_slow" / "tokenizer_config.json", destination / "tokenizer_config.json")
    shutil.rmtree(destination / "_slow")

    print(f"done: {destination}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_id", help="Hub id, for example facebook/mms-tts-swh")
    parser.add_argument("destination", type=Path, help="Directory to write the converted model into")
    parser.add_argument("--no-quantize", action="store_true", help="Skip the int8 copy")
    arguments = parser.parse_args()
    export(arguments.model_id, arguments.destination, not arguments.no_quantize)


if __name__ == "__main__":
    main()
