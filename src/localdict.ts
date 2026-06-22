import { StarDict } from "./dict.js";
import type { Lookup } from "./dict.js";

declare class Inflate {
  ondata: (data: Uint8Array, final: boolean) => void;
  constructor();
  push(chunk: Uint8Array, final?: boolean): void;
}
declare const fflate: { Inflate: typeof Inflate };

const inflate = (dzdata: Uint8Array) =>
  new Promise<Uint8Array>((resolve) => {
    const inflate = new fflate.Inflate();
    inflate.ondata = (data) => resolve(data);
    inflate.push(dzdata);
  });

const base =
  "http://localhost:52052/usr/share/stardict/dic/Spanish-English%20Wiktionary%20dictionary%20stardict/Spanish-English%20Wiktionary%20dictionary";
// const base = "http://localhost:52052/usr/share/stardict/dic/wikdict-es-en/stardict";

var resolveLoaded: (value: StarDict) => void;
export const dict = new Promise<StarDict>((resolve) => {
  resolveLoaded = resolve;
});

async function openAsBlob(path: string): Promise<Blob> {
  const res = await fetch(path);
  return await res.blob();
}

const reviveData = ([typ, arr]: [string, Uint8Array]) => {
  if (typ === "h") {
    return new TextDecoder().decode(arr);
  } else {
    throw new Error("Invalid data type");
  }
};

const reviveResults = (res: Lookup[]) => res.map((i) => ({ ...i, data: reviveData(i.data) }));

export async function loadStardict() {
  const d = new StarDict();
  await Promise.all([
    openAsBlob(base + ".ifo?a").then((ifo) => d.loadIfo(ifo)),
    openAsBlob(base + ".dict.dz").then((dz) => d.loadDict(dz, inflate)),
    openAsBlob(base + ".idx").then((idx) => d.loadIdx(idx)),
    openAsBlob(base + ".syn").then((syn) => d.loadSyn(syn)),
  ]);
  resolveLoaded(d);
}

export async function lookup(query: string) {
  const d = await dict;
  const res = await d.lookup(query);
  const synres = await d.synonyms(query);
  return reviveResults([...res, ...synres]);
}
