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

function filterVosotrosRow(row: HTMLTableRowElement) {
  const cells = row.cells;
  const idx = row.rowIndex;

  const decIndex = vosotrosFilterColumns[idx];
  if (cells[decIndex].colSpan === 1) {
    cells[decIndex].remove();
  } else {
    cells[decIndex].colSpan -= 1;
  }
}

function filterVosotrosTable(table: HTMLTableElement) {
  for (const i of table.rows) {
    filterVosotrosRow(i);
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

  fetch(constructURL(query), {
    method: "GET",
    headers: new Headers({
      "Api-User-Agent": "Spanish-Lookup/1.0 (emilia@rymiel.space)",
    }),
  })
    .then((r) => r.json())
    .then((json) => {
      const html = json.parse.text;

      let page = document.createElement("div");
      const spanishPage = document.createElement("div");
      page.innerHTML = html;

      // Delete all [edit] links, this is just for viewing, not editing
      page.querySelectorAll(".mw-editsection").forEach((i) => i.remove());
      // Delete all references [1], I don't need them here
      page.querySelectorAll(".reference").forEach((i) => i.remove());
      page.querySelectorAll(".external").forEach((i) => i.remove());

      const spanishHeader = page.querySelector<HTMLElement>("h2 span#Spanish")!.parentElement!;

      const spanishSection: HTMLElement[] = [];

      // we don't need "Spanish" at the top of the page, we already know it's spanish!
      // spanishSection.push(spanishHeader);

      // But I will add a h1 header to show the currently made search
      const searchHeader = document.createElement("h1");
      searchHeader.innerText = query;
      spanishSection.push(searchHeader);

      let nextHeader = spanishHeader.nextElementSibling as HTMLElement | null;
      while (nextHeader !== null && nextHeader.nodeName !== "H2") {
        spanishSection.push(nextHeader);
        nextHeader = nextHeader.nextElementSibling as HTMLElement | null;
      }

      spanishSection.forEach((el) => spanishPage.appendChild(el));
      page = spanishPage;

      const pronuncationTitle = spanishSection.find((el) => el.nodeName == "H3" && el.innerText == "Pronunciation");
      if (pronuncationTitle) {
        const pronuncation = findPronuncation(pronuncationTitle, page);

        if (pronuncation) {
          // Remove the whole Pronuncation section
          let i = spanishSection.indexOf(pronuncationTitle);
          spanishSection.splice(i, 1);
          while (spanishSection[i].nodeName != "H3") {
            spanishSection.splice(i, 1);
          }

          // Put the pronuncation directly in the title
          searchHeader.innerText = `<${query}> ${pronuncation}`;
        }
      }

      filterColors(page);
      filterLinks(page);

      const tables = page.querySelectorAll(".NavContent");
      if (tables.length > 0) {
        const primaryTable = tables[0].firstElementChild as HTMLTableElement;
        filterVosotrosTable(primaryTable);
        const presentIndicative = primaryTable.rows[8];
        const piForms = Array.from(presentIndicative.querySelectorAll("span")).map((i) => i.innerText);
        // vos and tú forms are the same, duplicate it
        if (piForms.length === 5) {
          piForms.splice(1, 0, piForms[1]);
        }

        const piTable = buildTable(pronouns, piForms);
        left.appendChild(piTable);
      }

      // Load into page
      loader.remove();
      spanishSection.forEach((el) => content.appendChild(el));
      queryBox.disabled = false;
      queryBox.select();
      document.title = `${query} | Spanish`;
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
    makeQuery(document.location.hash.substring(1));
  }
});

addEventListener("hashchange", () => {
  if (document.location.hash !== "") {
    makeQuery(document.location.hash.substring(1));
  }
});
