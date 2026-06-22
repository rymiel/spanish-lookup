import { addAnkiButtons, requestAnkiPermission } from "./anki.js";
import { loadStardict, lookup } from "./localdict.js";
import {
  delimitSection,
  keepOnlyLanguageSection,
  removeWiktionaryChrome,
  runRecursiveFilters,
} from "./wiktionary-dom.js";

let form: HTMLFormElement;
let queryBox: HTMLInputElement;
let content: HTMLDivElement;
let quickContent: HTMLDivElement;
let left: HTMLDivElement;
let activeQuery = "";

let controller = new AbortController();

const headers = new Headers({
  "Api-User-Agent": "Spanish-Lookup/1.0 (emilia@rymiel.space)",
});

const frequencies: Map<string, Record<string, number>> = new Map();
const VARIANTS = ["-freq", "-count"] as const;

type LoadingState = {
  quickLoader: HTMLDivElement;
  loader: HTMLDivElement;
};

type WiktionaryParseResponse = {
  error?: {
    code?: string;
    info?: string;
  };
  parse?: {
    text: string;
    wikitext: string;
  };
};

function constructURL(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://en.wiktionary.org/w/api.php?action=parse&page=${encoded}&prop=text|wikitext&formatversion=2&origin=*&format=json`;
}

function constructTemplateURL(template: string, title: string): string {
  const encodedTempl = encodeURIComponent(template);
  const encodedTitle = encodeURIComponent(title);
  return `https://en.wiktionary.org/w/api.php?action=expandtemplates&title=${encodedTitle}&text={{${encodedTempl}|json=1}}&prop=wikitext&formatversion=2&origin=*&format=json`;
}

function showError(message: string, title?: string) {
  const errorMessage = document.createElement("div");
  errorMessage.innerText = message;
  if (title !== undefined) {
    errorMessage.title = title;
  }
  content.appendChild(errorMessage);
}

function isActiveQuery(query: string) {
  return activeQuery === query;
}

function findPronunciation(pronunciationTitle: HTMLElement, page: HTMLElement): string | undefined {
  const pronunciationSection = pronunciationTitle.parentElement!.nextElementSibling! as HTMLElement;
  let pronunciationEntries: HTMLElement[] = Array.from(pronunciationSection.querySelectorAll("li")).filter((el) =>
    el.innerText.startsWith("IPA"),
  );
  const switcherEntries = Array.from(page.querySelectorAll(".vsSwitcher > .vsHide > ul > li")) as HTMLElement[];

  // Sometimes the pronunciations are in consecutive switchers, instead of directly under the "Pronunciation"
  // header. We can't use this in every case because sometimes the switchers aren't there at all, so just
  // use whichever one is more accurate.
  if (switcherEntries.length > pronunciationEntries.length) {
    pronunciationEntries = switcherEntries;
  }

  // Try to find the most Buenos Aires pronunciation.
  const correctPronunciation =
    pronunciationEntries.length === 1
      ? pronunciationEntries[0]
      : (pronunciationEntries.find((el) => el.innerText.includes("Buenos Aires")) ??
        pronunciationEntries.find((el) => el.innerText.includes("Latin America")));

  if (correctPronunciation === undefined) {
    console.error(
      `Couldn't find the correct pronunciation from the choices ${pronunciationEntries
        .map((el) => el.innerText)
        .join(", ")}`,
    );

    return undefined;
  } else {
    // Extract just the IPA. There's some jank here to account for words which do not vary by region. Those
    // are formatted slightly differently by wiktionary.
    return correctPronunciation.innerText.split("(", 3)[1].trim().substring(5).trim();
  }
}

const vosotrosFilterColumns = [1, 1, 1, 0, 0, 2, 4, 6, 5, 5, 5, 5, 5, 0, 6, 5, 5, 5, 5, 0, 6, 5, 5] as const;

function filterVosotrosTable(table: HTMLTableElement) {
  for (const row of table.rows) {
    const cells = row.cells;
    const decIndex = vosotrosFilterColumns[row.rowIndex];
    if (decIndex === undefined || cells[decIndex] === undefined) {
      continue;
    }

    if (cells[decIndex].colSpan === 1) {
      cells[decIndex].remove();
    } else {
      cells[decIndex].colSpan -= 1;
    }
  }
}

const compactableRows = [7, 14, 20];
function filterCompactTable(table: HTMLTableElement) {
  for (const row of table.rows) {
    if (!compactableRows.includes(row.rowIndex)) {
      continue;
    }

    for (const cell of Array.from(row.cells)) {
      if (cell.cellIndex == 0) {
        continue;
      }
      cell.remove();
    }
  }
}

function buildTable(a: readonly string[], b: readonly Node[]) {
  const formTable = document.createElement("table");
  formTable.className = "quick";

  a.forEach((_, i) => {
    const tr = document.createElement("tr");

    let aText = a[i];
    if (aText.startsWith("!")) {
      aText = aText.substring(1);
      tr.classList.add("gap");
    }
    const tda = document.createElement("th");
    tda.innerText = aText;
    tr.appendChild(tda);

    const tdb = document.createElement("td");
    tdb.appendChild(b[i]);
    tr.appendChild(tdb);

    formTable.appendChild(tr);
  });

  return formTable;
}

const PRONOUNS = [
  "yo",
  "tú",
  "vos",
  "ella",
  "nosotros",
  "ustedes",
  "!p. yo",
  "p. vos",
  "p. ella",
  "p. nosotros",
  "p. ustedes",
  "!subj.",
] as const;
const FORMS = [
  "pres_1s",
  "pres_2s",
  "pres_2sv",
  "pres_3s",
  "pres_1p",
  "pres_3p",
  "pret_1s",
  "pret_2s",
  "pret_3s",
  "pret_1p",
  "pret_3p",
  "pres_sub_1s",
] as const;
type EsConjForm = (typeof FORMS)[number];
interface EsConjEntry {
  form: string;
  footnotes?: string[];
}
interface EsConjJson {
  forms: Record<EsConjForm, EsConjEntry[]>;
}

// TODO: nicer layout of pages with multiple definitions (i.e. jump to definition)
// this includes pages with multiple "etymologies", for example `colmo`

const esConjRegex = /{{(es-conj[^}]*?)}}/;

function buildConjugationSidebar(innerJson: EsConjJson) {
  // TODO: include footnotes
  const forms = FORMS.map((i) => {
    const div = document.createElement("div");
    innerJson.forms[i]
      .map((j) => {
        const span = document.createElement("span");
        span.innerText = j.form;
        if (j.footnotes) {
          span.title = j.footnotes.join(", ");
          span.classList.add("footnote");
        }
        return span;
      })
      .forEach((span, i) => {
        if (i > 0) div.append(", ");
        div.appendChild(span);
      });
    return div;
  });

  return buildTable(PRONOUNS, forms);
}

function loadConjugationSidebar(wikitext: string, query: string, signal: AbortSignal) {
  const templateLookup = esConjRegex.exec(wikitext);
  if (!templateLookup?.[1]) {
    return;
  }

  const loader = document.createElement("div");
  loader.className = "loader";
  left.appendChild(loader);
  fetch(constructTemplateURL(templateLookup[1], query), {
    method: "GET",
    headers: headers,
    signal,
  })
    .then((r) => r.json())
    .then((json) => {
      if (!isActiveQuery(query) || signal.aborted) {
        return;
      }

      const innerJson = JSON.parse(json.expandtemplates.wikitext) as EsConjJson;
      left.appendChild(buildConjugationSidebar(innerJson));
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      console.error(err);
    })
    .finally(() => loader.remove());
}

function addPronunciationToHeader(page: HTMLElement, query: string, searchHeader: HTMLHeadingElement) {
  const pronunciationTitle = page.querySelector<HTMLElement>("h3[data-h=Pronunciation]");
  if (!pronunciationTitle) {
    return;
  }

  const pronunciation = findPronunciation(pronunciationTitle, page);
  if (!pronunciation) {
    return;
  }

  delimitSection(pronunciationTitle).forEach((i) => i.remove());
  pronunciationTitle.remove();
  searchHeader.innerText = `<${query}> ${pronunciation}`;
}

function addFrequencyList(searchHeader: HTMLHeadingElement, query: string, params: URLSearchParams) {
  const freqs = params.get("freq");
  if (freqs === null) {
    return;
  }

  const container = document.createElement("div");
  container.classList.add("freqlist");
  searchHeader.insertAdjacentElement("afterend", container);

  freqs.split(",").forEach((id, i) => {
    if (i > 0) container.insertAdjacentElement("beforeend", document.createElement("br"));

    const freq = frequencies.get(`${id}-freq`);
    const count = frequencies.get(`${id}-count`);
    const freqValue = freq ? (freq[query] ?? 0).toString() : "?";
    const countValue = count ? (count[query] ?? 0).toString() : "?";
    const freqEl = document.createElement("span");
    freqEl.innerText = `${id}: ${freqValue}`;
    container.insertAdjacentElement("beforeend", freqEl);
    const countEl = document.createElement("span");
    countEl.innerText = `(count): ${countValue}`;
    container.insertAdjacentElement("beforeend", countEl);
  });
}

function collapseEtymologies(page: HTMLElement) {
  const etymologyTitles = page.querySelectorAll<HTMLElement>("h3[data-h^=Etymology]");
  etymologyTitles.forEach((etymologyTitle) => {
    const content = delimitSection(etymologyTitle, 4);

    const details = document.createElement("details");
    etymologyTitle.insertAdjacentElement("afterend", details);

    const summary = document.createElement("summary");
    details.insertAdjacentElement("afterbegin", summary);

    summary.appendChild(etymologyTitle);
    content.forEach((i) => details.appendChild(i));
  });
}

function trimConjugationTables(page: HTMLElement) {
  const tables = Array.from(page.querySelectorAll(".NavFrame .NavContent")).filter((i) =>
    (i.previousElementSibling as HTMLElement).textContent?.trim().startsWith("Conjugation of"),
  );
  const primaryTable = tables[0]?.firstElementChild;
  if (primaryTable instanceof HTMLTableElement) {
    filterVosotrosTable(primaryTable);
    filterCompactTable(primaryTable);
  }
}

function removeReferences(page: HTMLElement) {
  const referenceTitles = ["References", "Further reading"].flatMap((i) => [
    ...page.querySelectorAll<HTMLElement>(`[data-h='${i}']`),
  ]);
  referenceTitles.forEach((referenceTitle) => {
    delimitSection(referenceTitle).forEach((i) => i.remove());
    referenceTitle.remove();
  });
}

function renderSpanishDefinition(
  page: HTMLElement,
  query: string,
  wikitext: string,
  params: URLSearchParams,
  signal: AbortSignal,
  cleanup: () => void,
) {
  if (!keepOnlyLanguageSection(page, "Spanish")) {
    if (isActiveQuery(query)) {
      showError("This page has no Spanish entry!");
      cleanup();
    }
    return;
  }

  loadConjugationSidebar(wikitext, query, signal);
  runRecursiveFilters(page);

  const searchHeader = document.createElement("h1");
  searchHeader.innerText = query;
  page.prepend(searchHeader);

  addPronunciationToHeader(page, query, searchHeader);
  addFrequencyList(searchHeader, query, params);
  collapseEtymologies(page);
  trimConjugationTables(page);
  removeReferences(page);
  if (params.has("anki")) {
    addAnkiButtons(page);
  }

  if (isActiveQuery(query)) {
    cleanup();
    content.appendChild(page);
    document.title = `${query} | Spanish`;
  }
}

function buildTranslationBlock(navFrame: HTMLElement): HTMLElement | null {
  if (navFrame.className !== "NavFrame") return null;
  const navHeader = navFrame.firstElementChild as HTMLElement;
  if (navHeader.className !== "NavHead") return null;
  const navContent = navFrame.lastElementChild;
  if (!(navContent instanceof HTMLElement) || navContent.className !== "NavContent") return null;
  const trEnglish = navHeader.innerText;
  if (trEnglish === "Translations to be checked") return null;

  const trElement = document.createElement("div");
  const trKey = document.createElement("span");
  trKey.innerText = trEnglish + ": ";
  trElement.appendChild(trKey);

  const trEntries = Array.from(navContent.querySelectorAll('li > span[lang="es"]'));
  if (trEntries.length === 0) {
    const trNothing = document.createElement("span");
    trNothing.innerText = "No translations";
    trNothing.className = "nothing";
    trElement.appendChild(trNothing);
  } else {
    trEntries.forEach((e, i) => {
      if (i > 0) {
        trElement.appendChild(document.createTextNode(", "));
      }
      e.classList.add("tr");
      trElement.appendChild(e);
    });
  }

  runRecursiveFilters(trElement);
  return trElement;
}

function extractTranslationBlocks(page: HTMLElement) {
  const translationHeadings = page.querySelectorAll<HTMLElement>("[id^=Translations].mw-headline");
  const translationSections = Array.from(translationHeadings).flatMap((i) => delimitSection(i.parentElement!));
  return translationSections.flatMap((i) => {
    const block = buildTranslationBlock(i);
    return block === null ? [] : [block];
  });
}

// TODO: fix for those random pages which have their translations on a separate page for some reason
function renderEnglishTranslations(page: HTMLElement, query: string, cleanup: () => void) {
  const rawQuery = query + "?";
  if (!keepOnlyLanguageSection(page, "English")) {
    if (isActiveQuery(rawQuery)) {
      showError("This page has no English entry!");
      cleanup();
    }
    return;
  }

  const searchHeader = document.createElement("h1");
  searchHeader.innerText = query;
  page.prepend(searchHeader);

  const translations = extractTranslationBlocks(page);
  if (translations.length === 0) {
    if (isActiveQuery(rawQuery)) {
      showError("This page has no translations!");
      cleanup();
    }
    return;
  }

  if (isActiveQuery(rawQuery)) {
    cleanup();
    translations.forEach((el) => content.appendChild(el));
    document.title = `${query}? | Spanish`;
  }
}

function startLoading(): LoadingState {
  content.innerHTML = "";
  quickContent.innerHTML = "";
  left.innerHTML = "";

  const quickLoader = document.createElement("div");
  quickLoader.className = "quick loader";
  quickContent.appendChild(quickLoader);

  const loader = document.createElement("div");
  loader.className = "loader";
  content.appendChild(loader);

  return { quickLoader, loader };
}

function finishLoading(loaders: LoadingState) {
  loaders.loader.remove();
  loaders.quickLoader.remove();
  queryBox.disabled = false;
  queryBox.select();
  document.title = "Spanish";
}

function loadQuickResults(query: string, rawQuery: string, quickLoader: HTMLDivElement, params: URLSearchParams) {
  if (!params.has("star")) {
    quickLoader.remove();
    return;
  }

  lookup(query)
    .then((results) => {
      if (!isActiveQuery(rawQuery)) {
        return;
      }

      quickLoader.remove();
      results.forEach((m) => {
        const h = document.createElement("h3");
        h.innerText = m.word ?? "?";
        quickContent.appendChild(h);
        new DOMParser()
          .parseFromString(m.data, "text/html")
          .body.childNodes.forEach((n) => quickContent.appendChild(n));
      });
    })
    .catch((err) => {
      if (isActiveQuery(rawQuery)) {
        quickLoader.remove();
        console.error(err);
      }
    });
}

function parseWiktionaryPage(html: string) {
  const page = new DOMParser().parseFromString(html, "text/html").body.children[0] as HTMLElement;
  removeWiktionaryChrome(page);
  return page;
}

function showApiError(json: WiktionaryParseResponse, rawQuery: string, cleanup: () => void) {
  console.error(json.error);
  if (json.error?.info) {
    showError(json.error.info, json.error.code);
  } else {
    showError("An unknown error ocurred", json.toString());
  }
  if (isActiveQuery(rawQuery)) {
    cleanup();
  }
}

function makeQuery(rawQuery: string) {
  if (rawQuery == activeQuery) {
    return;
  }

  activeQuery = rawQuery;
  queryBox.value = rawQuery;
  window.location.hash = rawQuery;
  queryBox.disabled = true;
  const loaders = startLoading();
  const cleanup = () => finishLoading(loaders);
  const params = new URLSearchParams(window.location.search);

  const isTranslationLookup = rawQuery.endsWith("?");
  const query = isTranslationLookup ? rawQuery.substring(0, rawQuery.length - 1) : rawQuery;

  loadQuickResults(query, rawQuery, loaders.quickLoader, params);

  controller.abort();
  controller = new AbortController();
  const signal = controller.signal;

  fetch(constructURL(query), {
    method: "GET",
    signal,
    headers: headers,
  })
    .then((r) => r.json() as Promise<WiktionaryParseResponse>)
    .then((json) => {
      if (!isActiveQuery(rawQuery)) {
        return;
      }

      if (json.error) {
        showApiError(json, rawQuery, cleanup);
        return;
      }
      if (!json.parse) {
        showError("An unknown error ocurred", json.toString());
        cleanup();
        return;
      }

      const page = parseWiktionaryPage(json.parse.text);
      if (isTranslationLookup) {
        renderEnglishTranslations(page, query, cleanup);
      } else {
        renderSpanishDefinition(page, query, json.parse.wikitext, params, signal, cleanup);
      }
    })
    .catch((err) => {
      if (isActiveQuery(rawQuery)) {
        cleanup();
        console.error(err);
      }
    });
}

function initializeFrequencyLists(params: URLSearchParams) {
  const freqs = params.get("freq");
  if (freqs === null) {
    return;
  }

  (async () => {
    for (const key of freqs.split(",")) {
      for (const suffix of VARIANTS) {
        try {
          const res = await fetch(`/freq/${key}${suffix}.json`);
          const json = await res.json();
          frequencies.set(`${key}${suffix}`, json);
        } catch {
          frequencies.set(`${key}${suffix}`, {});
        }
      }
    }
  })();
}

addEventListener("load", () => {
  form = document.getElementById("form") as HTMLFormElement;
  const params = new URLSearchParams(window.location.search);
  if (params.has("inline")) {
    form.classList.add("hidden");
  }

  queryBox = document.getElementById("query") as HTMLInputElement;
  content = document.getElementById("content") as HTMLDivElement;
  quickContent = document.getElementById("quickContent") as HTMLDivElement;
  left = document.getElementById("leftMain") as HTMLDivElement;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = queryBox.value;

    makeQuery(query.toLowerCase());
  });

  if (document.location.hash !== "") {
    makeQuery(decodeURIComponent(document.location.hash.substring(1).toLowerCase()));
  }

  if (params.has("anki")) {
    requestAnkiPermission();
  }

  initializeFrequencyLists(params);

  if (params.has("star")) {
    loadStardict().then(() => console.log("stardict loaded"));
  }
});

addEventListener("hashchange", () => {
  if (document.location.hash !== "") {
    makeQuery(decodeURIComponent(document.location.hash.substring(1).toLowerCase()));
  }
});
