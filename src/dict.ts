const decoder = new TextDecoder();
const decode = decoder.decode.bind(decoder);

const concatTypedArray = (a: Uint8Array, b: Uint8Array) => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

const strcmp = (a: string, b: string) => {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
};

type Inflater = (arr: Uint8Array) => Promise<Uint8Array>;

class DictZip {
  #chlen: number;
  #chunks: [number, number][];
  #compressed: Blob;
  #inflate: Inflater;

  constructor(chlen: number, chunks: [number, number][], compressed: Blob, inflate: Inflater) {
    this.#chlen = chlen;
    this.#chunks = chunks;
    this.#compressed = compressed;
    this.#inflate = inflate;
  }

  static async load(file: Blob, inflate: Inflater): Promise<DictZip> {
    const header = new DataView(await file.slice(0, 12).arrayBuffer());
    if (header.getUint8(0) !== 31 || header.getUint8(1) !== 139 || header.getUint8(2) !== 8)
      throw new Error("Not a DictZip file");
    const flg = header.getUint8(3);

    const xlen = header.getUint16(10, true);
    const extra = new DataView(await file.slice(12, 12 + xlen).arrayBuffer());
    if (extra.getUint8(0) !== 82 || extra.getUint8(1) !== 65) throw new Error("Subfield ID should be RA");
    if (extra.getUint16(4, true) !== 1) throw new Error("Unsupported version");

    const chlen = extra.getUint16(6, true);
    const chcnt = extra.getUint16(8, true);
    const chunks: [number, number][] = [];
    for (let i = 0, chunkOffset = 0; i < chcnt; i++) {
      const chunkSize = extra.getUint16(10 + 2 * i, true);
      chunks.push([chunkOffset, chunkSize]);
      chunkOffset = chunkOffset + chunkSize;
    }

    // skip to compressed data
    let offset = 12 + xlen;
    const max = Math.min(offset + 512, file.size);
    const strArr = new Uint8Array(await file.slice(0, max).arrayBuffer());
    if (flg & 0b1000) {
      // fname
      const i = strArr.indexOf(0, offset);
      if (i < 0) throw new Error("Header too long");
      offset = i + 1;
    }
    if (flg & 0b10000) {
      // fcomment
      const i = strArr.indexOf(0, offset);
      if (i < 0) throw new Error("Header too long");
      offset = i + 1;
    }
    if (flg & 0b10) offset += 2; // fhcrc
    const compressed = file.slice(offset);

    return new DictZip(chlen, chunks, compressed, inflate);
  }

  async read(offset: number, size: number) {
    const chunks = this.#chunks;
    const startIndex = Math.trunc(offset / this.#chlen);
    const endIndex = Math.trunc((offset + size) / this.#chlen);
    const buf = await this.#compressed
      .slice(chunks[startIndex][0], chunks[endIndex][0] + chunks[endIndex][1])
      .arrayBuffer();
    let arr = new Uint8Array();
    for (let pos = 0, i = startIndex; i <= endIndex; i++) {
      const data = new Uint8Array(buf, pos, chunks[i][1]);
      arr = concatTypedArray(arr, await this.#inflate(data));
      pos += chunks[i][1];
    }
    const startOffset = offset - startIndex * this.#chlen;
    return arr.subarray(startOffset, startOffset + size);
  }
}

class StarDictIndex {
  strcmp = strcmp;
  words: [number, number][];
  offsets: number[];
  sizes: number[];
  isSyn: boolean;
  #arr: Uint8Array;

  constructor(words: [number, number][], offsets: number[], sizes: number[], isSyn: boolean, arr: Uint8Array) {
    this.words = words;
    this.offsets = offsets;
    this.sizes = sizes;
    this.isSyn = isSyn;
    this.#arr = arr;
  }

  // binary search
  bisect(query: string, start = 0, end = this.words.length - 1): number | null {
    if (end - start === 1) {
      const startWord = this.getWord(start);
      if (startWord === undefined) return null;
      if (!this.strcmp(query, startWord)) return start;
      const endWord = this.getWord(end);
      if (endWord === undefined) return null;
      if (!this.strcmp(query, endWord)) return end;
      return null;
    }
    const mid = Math.floor(start + (end - start) / 2);
    const midWord = this.getWord(mid);
    if (midWord === undefined) return null;
    const cmp = this.strcmp(query, midWord);
    if (cmp < 0) return this.bisect(query, start, mid);
    if (cmp > 0) return this.bisect(query, mid, end);
    return mid;
  }

  // check for multiple definitions
  checkAdjacent(query: string, i: number | null): number[] {
    if (i == null) return [];
    let j = i;
    const equals = (i: number) => {
      const word = this.getWord(i);
      return word ? this.strcmp(query, word) === 0 : false;
    };
    while (equals(j - 1)) j--;
    let k = i;
    while (equals(k + 1)) k++;
    return j === k ? [i] : Array.from({ length: k + 1 - j }, (_, i) => j + i);
  }

  lookup(query: string): number[] {
    return this.checkAdjacent(query, this.bisect(query));
  }

  getWord(i: number): string | undefined {
    const word = this.words[i];
    if (!word) return;
    return decode(this.#arr.subarray(word[0], word[1]));
  }

  static async load(file: Blob, isSyn: boolean): Promise<StarDictIndex> {
    const buf = await file.arrayBuffer();
    const arr = new Uint8Array(buf);
    const view = new DataView(buf);
    const words: [number, number][] = [];
    const offsets = [];
    const sizes = [];
    for (let i = 0; i < arr.length; ) {
      const newI = arr.subarray(0, i + 256).indexOf(0, i);
      if (newI < 0) throw new Error("Word too big");
      words.push([i, newI]);
      offsets.push(view.getUint32(newI + 1));
      if (isSyn) i = newI + 5;
      else {
        sizes.push(view.getUint32(newI + 5));
        i = newI + 9;
      }
    }

    return new StarDictIndex(words, offsets, sizes, isSyn, arr);
  }
}

export interface Lookup {
  word: string;
  data: [string, Uint8Array];
}

export class StarDict {
  #dict?: DictZip;
  #idx?: StarDictIndex;
  #syn?: StarDictIndex;
  ifo: Record<string, string> = {};
  async loadIfo(file: Blob) {
    const str = decode(await file.arrayBuffer());
    this.ifo = Object.fromEntries(
      str
        .split("\n")
        .map((line) => {
          const sep = line.indexOf("=");
          if (sep < 0) return;
          return [line.slice(0, sep), line.slice(sep + 1)];
        })
        .filter((x) => x !== undefined)
    );
  }
  async loadDict(file: Blob, inflate: Inflater): Promise<void> {
    this.#dict = await DictZip.load(file, inflate);
  }
  async loadIdx(file: Blob): Promise<void> {
    this.#idx = await StarDictIndex.load(file, false);
  }
  async loadSyn(file: Blob): Promise<void> {
    this.#syn = await StarDictIndex.load(file, true);
  }
  async #readWord(i: number): Promise<Lookup | null> {
    if (this.#dict === undefined) throw new Error("Dictionary not loaded");
    if (this.#idx === undefined) throw new Error("Index not loaded");
    const word = this.#idx.getWord(i);
    if (word === undefined) return null;
    const offset = this.#idx.offsets[i];
    const size = this.#idx.sizes[i];
    const data = await this.#dict.read(offset, size);
    const seq = this.ifo.sametypesequence;
    if (!seq) throw new Error("TODO");
    if (seq.length === 1) return { word, data: [seq[0], data] };
    throw new Error("TODO");
  }
  async #readWords(arr: number[]): Promise<Lookup[]> {
    const i = await Promise.all(arr.map(this.#readWord.bind(this)));
    return i.filter((j) => j !== null);
  }
  lookup(query: string) {
    if (this.#idx === undefined) throw new Error("Index not loaded");
    return this.#readWords(this.#idx.lookup(query));
  }
  synonyms(query: string) {
    const syn = this.#syn;
    if (syn === undefined) throw new Error("Synonyms not loaded");
    return this.#readWords(syn.lookup(query).map((i) => syn.offsets[i]));
  }
}
