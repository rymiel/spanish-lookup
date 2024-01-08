let form: HTMLFormElement;
let queryBox: HTMLInputElement;
let content: HTMLDivElement;
let left: HTMLDivElement;
let activeQuery: string;

function constructURL(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://en.wiktionary.org/w/api.php?action=parse&page=${encoded}&prop=text&formatversion=2&origin=*&format=json`;
}

function rgb(s: string): number[] {
  return s
    .substring(4, s.length - 1)
    .split(", ")
    .map((i) => parseInt(i));
}

function unrgb(n: number[]) {
  return `rgb(${n.join(", ")})`;
}

function findPronuncation(pronuncationTitle: HTMLElement, page: HTMLDivElement): string | undefined {
  const pronuncationSection = pronuncationTitle.nextElementSibling! as HTMLElement;
  let pronuncationEntries: HTMLElement[] = Array.from(pronuncationSection.querySelectorAll("li")).filter((el) =>
    el.innerText.startsWith("IPA")
  );
  const switcherEntries = Array.from(page.querySelectorAll(".vsSwitcher > .vsHide > ul > li")) as HTMLElement[];

  // Sometimes the pronuncations are in consecutive switchers, instead of directly under the "Pronuncation"
  // header. We can't use this in every case because sometimes the switchers aren't there at all, so just
  // use whichever one is more accurate.
  if (switcherEntries.length > pronuncationEntries.length) {
    pronuncationEntries = switcherEntries;
  }

  // Try to find the most Buenos Aires pronuncation
  const correctPronuncation =
    pronuncationEntries.length === 1
      ? pronuncationEntries[0]
      : pronuncationEntries.find((el) => {
          const inner = el.innerText;
          return inner.includes("(Buenos Aires and environs)") || inner.includes("(Latin America)");
        });

  if (correctPronuncation === undefined) {
    console.error(
      `Couldn't find the correct pronuncation from the choices ${pronuncationEntries
        .map((el) => el.innerText)
        .join(", ")}`
    );

    return undefined;
  } else {
    // Extract just the IPA. There's some jank here to account for words which do not vary by region. Those
    // are formatted slightly differently by wiktionary.
    const parts = correctPronuncation.innerText.split(")", 3);
    let pronuncationText = parts[parts.length - 1].trim();
    if (pronuncationText.startsWith(":")) {
      pronuncationText = pronuncationText.substring(1).trim();
    }

    return pronuncationText;
  }
}

function filterColors(el: HTMLElement) {
  const bg = el.style.backgroundColor;
  if (bg !== "") {
    const inverted = rgb(bg).map((i) => 255 - i);
    el.style.backgroundColor = unrgb(inverted);
  }
  Array.from(el.children).forEach((i) => filterColors(i as HTMLElement));
}

function filterLinks(el: HTMLElement) {
  if (el instanceof HTMLAnchorElement) {
    const href = el.href;
    if (href !== "") {
      if (href.startsWith(window.location.origin)) {
        const suffix = href.substring(window.location.origin.length);
        if (suffix.endsWith("#Spanish") && suffix.startsWith("/wiki/")) {
          const page = suffix.substring(6, suffix.length - 8);
          el.classList.add("inlink");
          el.href = "#" + page;
        } else {
          el.href = "https://en.wiktionary.org/" + suffix;
          el.target = "_blank";
        }
      } else {
        el.target = "_blank";
      }
    }
  }
  Array.from(el.children).forEach((i) => filterLinks(i as HTMLElement));
}

const vosotrosFilterColumns = [1, 1, 1, 0, 0, 2, 4, 6, 5, 5, 5, 5, 5, 0, 6, 5, 5, 5, 5, 0, 6, 5, 5] as const;

function filterVosotrosTable(table: HTMLTableElement) {
  for (const row of table.rows) {
    const cells = row.cells;
    const idx = row.rowIndex;

    const decIndex = vosotrosFilterColumns[idx];
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
    if (compactableRows.indexOf(row.rowIndex) == -1) {
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

const pronouns = ["yo", "tú", "vos", "él", "nosotros", "ustedes"] as const;

function buildTable(a: readonly string[], b: readonly string[]) {
  const formTable = document.createElement("table");
  formTable.className = "quick";

  a.forEach((_, i) => {
    const tr = document.createElement("tr");

    const tda = document.createElement("th");
    tda.innerText = a[i];
    tr.appendChild(tda);

    const tdb = document.createElement("td");
    tdb.innerText = b[i];
    tr.appendChild(tdb);

    formTable.appendChild(tr);
  });

  return formTable;
}

function isHeaderName(str: string) {
  return str === "H1" || str === "H2" || str === "H3" || str === "H4" || str === "H5";
}

function equalOrHigherLevel(base: string, other: string) {
  if (!isHeaderName(base) || !isHeaderName(other)) {
    return false;
  }

  const baseLevel = parseInt(base[1]);
  const otherLevel = parseInt(other[1]);
  return otherLevel <= baseLevel;
}

function delimitSection(startHeader: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const level = startHeader.nodeName;
  if (!isHeaderName(level)) {
    throw new Error(`Cannot delimit non-header element ${level}`);
  }
  let next = startHeader.nextElementSibling as HTMLElement | null;
  while (next !== null && !equalOrHigherLevel(level, next.nodeName)) {
    elements.push(next);
    next = next.nextElementSibling as HTMLElement | null;
  }
  return elements;
}

function removeFromArray<T>(array: T[], ...elements: T[]) {
  elements.forEach((e) => {
    const i = array.indexOf(e);
    if (i !== -1) {
      array.splice(i, 1);
    }
  });
}

function spanishDefinitionLookup(page: HTMLDivElement, query: string, cleanup: () => void) {
  const spanishPage = document.createElement("div");

  const spanishHeader = page.querySelector<HTMLElement>("h2 span#Spanish")?.parentElement;
  if (!spanishHeader) {
    const errorMessage = document.createElement("div");
    errorMessage.innerText = "This page has no Spanish entry!";
    content.appendChild(errorMessage);
    cleanup();
    return;
  }

  const spanishSection: HTMLElement[] = [];

  const searchHeader = document.createElement("h1");
  searchHeader.innerText = query;
  spanishSection.push(searchHeader);

  spanishSection.push(...delimitSection(spanishHeader));

  spanishSection.forEach((el) => spanishPage.appendChild(el));
  // I'm not sure how the javascript GC and DOM stuff works, but just in case clean up the stuff we're not using
  page.remove();
  page = spanishPage;

  const pronuncationTitle = spanishSection.find((el) => el.nodeName == "H3" && el.innerText == "Pronunciation");
  if (pronuncationTitle) {
    const pronuncation = findPronuncation(pronuncationTitle, page);

    if (pronuncation) {
      // Remove the whole Pronuncation section
      removeFromArray(spanishSection, pronuncationTitle, ...delimitSection(pronuncationTitle));

      // Put the pronuncation directly in the title
      searchHeader.innerText = `<${query}> ${pronuncation}`;
    }
  }

  filterColors(page);
  filterLinks(page);

  const tables = page.querySelectorAll(".NavContent");
  if (tables.length > 0) {
    // TODO: fix for Phrasebook entries
    const primaryTable = tables[0].firstElementChild as HTMLTableElement;
    filterVosotrosTable(primaryTable);
    filterCompactTable(primaryTable);
    const presentIndicative = primaryTable.rows[8];
    const piForms = Array.from(presentIndicative.querySelectorAll("span")).map((i) => i.innerText);
    // drop the "present" label
    piForms.splice(0, 1);
    // just make a special case for hay
    // TODO: actually care about each element in each table cell
    if (piForms[3] === "hay") {
      piForms.splice(3, 1);
      piForms.splice(1, 0, piForms[1]);
    } else if (piForms.length === 5) {
      // vos and tú forms are the same, duplicate it
      piForms.splice(1, 0, piForms[1]);
    }

    const piTable = buildTable(pronouns, piForms);
    left.appendChild(piTable);
  }

  // Load into page
  cleanup();
  spanishSection.forEach((el) => content.appendChild(el));
  document.title = `${query} | Spanish`;
}

// TODO: fix for those random pages which have their translations on a separate page for some reason
function englishTranslationLookup(page: HTMLDivElement, query: string, cleanup: () => void) {
  const englishPage = document.createElement("div");
  const englishHeader = page.querySelector<HTMLElement>("h2 span#English")!.parentElement!;

  const englishSection: HTMLElement[] = [];

  const searchHeader = document.createElement("h1");
  searchHeader.innerText = query;
  englishSection.push(searchHeader);

  englishSection.push(...delimitSection(englishHeader));

  englishSection.forEach((el) => englishPage.appendChild(el));
  // I'm not sure how the javascript GC and DOM stuff works, but just in case clean up the stuff we're not using
  page.remove();
  page = englishPage;

  const translationHeadings = page.querySelectorAll<HTMLElement>("[id^=Translations].mw-headline");
  const translationSections = Array.from(translationHeadings).flatMap((i) => delimitSection(i.parentElement!));

  const trList: HTMLElement[] = [];
  translationSections.forEach((i) => {
    if (i.className !== "NavFrame") return;
    const navHeader = i.firstElementChild! as HTMLElement;
    if (navHeader.className !== "NavHead") return;
    const navContent = i.lastElementChild!;
    if (navContent.className !== "NavContent") return;
    const trEnglish = navHeader.innerText;
    if (trEnglish === "Translations to be checked") return;

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

    filterLinks(trElement);
    trList.push(trElement);
  });

  cleanup();
  trList.forEach((el) => content.appendChild(el));
  document.title = `${query}? | Spanish`;
}

function startLoading() {
  // Clear previous results and create a spinner
  content.innerHTML = "";
  left.innerHTML = "";
  const loader = document.createElement("div");
  loader.className = "loader";
  content.appendChild(loader);

  return loader;
}

function makeQuery(query: string) {
  if (query == activeQuery) {
    return;
  }

  activeQuery = query;
  queryBox.value = query;
  window.location.hash = query;
  queryBox.disabled = true;
  const loader = startLoading();

  const cleanup = () => {
    loader.remove();
    queryBox.disabled = false;
    queryBox.select();
    document.title = "Spanish";
  };

  const isTranslationLookup = query.endsWith("?");
  if (isTranslationLookup) {
    query = query.substring(0, query.length - 1);
  }

  fetch(constructURL(query), {
    method: "GET",
    headers: new Headers({
      "Api-User-Agent": "Spanish-Lookup/1.0 (emilia@rymiel.space)",
    }),
  })
    .then((r) => r.json())
    .then((json) => {
      // console.log(json);
      if (json.error) {
        console.error(json.error);
        const errorMessage = document.createElement("div");
        if (json.error.info) {
          errorMessage.title = json.error.code;
          errorMessage.innerText = json.error.info;
        } else {
          errorMessage.title = json.toString();
          errorMessage.innerText = "An unknown error ocurred";
        }
        content.appendChild(errorMessage);
        cleanup();
        return;
      }
      const html = json.parse.text;

      let page = document.createElement("div");
      page.innerHTML = html;

      // Delete all [edit] links, this is just for viewing, not editing
      page.querySelectorAll(".mw-editsection").forEach((i) => i.remove());
      // Delete all references [1], I don't need them here
      page.querySelectorAll(".reference").forEach((i) => i.remove());
      page.querySelectorAll(".external").forEach((i) => i.remove());

      if (isTranslationLookup) {
        englishTranslationLookup(page, query, cleanup);
      } else {
        spanishDefinitionLookup(page, query, cleanup);
      }
    })
    .catch((err) => {
      cleanup();
      console.error(err);
    });
}

addEventListener("load", () => {
  form = document.getElementById("form") as HTMLFormElement;
  queryBox = document.getElementById("query") as HTMLInputElement;
  content = document.getElementById("content") as HTMLDivElement;
  left = document.getElementById("leftMain") as HTMLDivElement;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = queryBox.value;

    makeQuery(query);
  });

  if (document.location.hash !== "") {
    makeQuery(decodeURIComponent(document.location.hash.substring(1)));
  }
});

addEventListener("hashchange", () => {
  if (document.location.hash !== "") {
    makeQuery(decodeURIComponent(document.location.hash.substring(1)));
  }
});
