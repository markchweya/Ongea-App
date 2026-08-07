/**
 * The espeak-ng package ships no types. It is the eSpeak NG command line tool
 * compiled by Emscripten, so the module is a factory that runs `main` with the
 * arguments given and exposes the virtual filesystem it wrote to.
 */
declare module 'espeak-ng' {
  interface ESpeakFileSystem {
    readFile(path: string, options: { encoding: 'utf8' }): string
    readFile(path: string): Uint8Array
  }

  interface ESpeakInstance {
    FS: ESpeakFileSystem
  }

  interface ESpeakOptions {
    /** argv for the eSpeak CLI, minus the program name. */
    arguments?: string[]
    print?: (line: string) => void
    printErr?: (line: string) => void
    locateFile?: (path: string, prefix: string) => string
  }

  export default function ESpeakNg(options?: ESpeakOptions): Promise<ESpeakInstance>
}
