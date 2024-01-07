let form: HTMLFormElement;
let queryBox: HTMLInputElement;
let content: HTMLDivElement;
let left: HTMLDivElement;

function constructURL(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://en.wiktionary.org/w/api.php?action=parse&page=${encoded}&prop=text&formatversion=2&origin=*&format=json`;
}

addEventListener("load", () => {
  form = document.getElementById("form") as HTMLFormElement;
  queryBox = document.getElementById("query") as HTMLInputElement;
  content = document.getElementById("content") as HTMLDivElement;
  left = document.getElementById("leftMain") as HTMLDivElement;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = queryBox.value;
    console.log(query);

    // Clear previous results and create a spinner
    content.innerHTML = "";
    left.innerHTML = "";
    const loader = document.createElement("div");
    loader.className = "loader";
    content.appendChild(loader);

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

        const spanishHeaderText = page.querySelector("h2 span#Spanish") as HTMLElement;
        const spanishHeader = spanishHeaderText.parentElement!;

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

        const pronuncationTitle = spanishSection.find(
          (el) => el.nodeName == "H3" && el.innerText == "Pronunciation"
        ) as HTMLElement;
        if (pronuncationTitle) {
          const pronuncationSection = pronuncationTitle.nextElementSibling as HTMLElement;
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
            window.alert(
              `Couldn't find the correct pronuncation from the choices ${pronuncationEntries
                .map((el) => el.innerText)
                .join(", ")}`
            );
          } else {
            // Extract just the IPA. There's some jank here to account for words which do not vary by region. Those
            // are formatted slightly differently by wiktionary.
            const parts = correctPronuncation.innerText.split(")", 3);
            let pronuncationText = parts[parts.length - 1]!.trim();
            if (pronuncationText.startsWith(":")) {
              pronuncationText = pronuncationText.substring(1).trim();
            }

            // Remove the whole Pronuncation section
            let i = spanishSection.indexOf(pronuncationTitle);
            spanishSection.splice(i, 1);
            while (spanishSection[i]!.nodeName != "H3") {
              spanishSection.splice(i, 1);
            }

            // Put the pronuncation directly in the title
            searchHeader.innerText = `<${query}> ${pronuncationText}`;
          }
        }

        const rgb = (s: string): number[] =>
          s
            .substring(4, s.length - 1)
            .split(", ")
            .map((i) => parseInt(i));

        const unrgb = (n: number[]) => `rgb(${n.join(", ")})`;

        const filterColors = (el: HTMLElement) => {
          const bg = el.style.backgroundColor;
          if (bg !== "") {
            const inverted = rgb(bg).map((i) => 255 - i);
            el.style.backgroundColor = unrgb(inverted);
          }
          Array.from(el.children).forEach((i) => filterColors(i as HTMLElement));
        };

        filterColors(page);

        const vosotrosFilterColumns = [1, 1, 1, 0, 0, 2, 4, 6, 5, 5, 5, 5, 5, 0, 6, 5, 5, 5, 5, 0, 6, 5, 5];

        const filterVosotrosRow = (row: HTMLTableRowElement) => {
          const cells = row.cells;
          const idx = row.rowIndex;

          const decIndex = vosotrosFilterColumns[idx]!;
          if (cells[decIndex]!.colSpan === 1) {
            cells[decIndex]!.remove();
          } else {
            cells[decIndex]!.colSpan -= 1;
          }
        };

        /** @param {HTMLTableElement} table */
        const filterVosotrosTable = (table: HTMLTableElement) => {
          for (const i of table.rows) {
            filterVosotrosRow(i);
          }
        };

        const buildTable = (a: string[], b: string[]) => {
          const formTable = document.createElement("table");
          formTable.className = "quick";

          a.forEach((_, i) => {
            const tr = document.createElement("tr");

            const tda = document.createElement("th");
            tda.innerText = a[i];
            const tdb = document.createElement("td");
            tdb.innerText = b[i];

            tr.appendChild(tda);
            tr.appendChild(tdb);
            formTable.appendChild(tr);
          });

          return formTable;
        };

        /** @type {NodeListOf<HTMLElement>} */
        const tables: NodeListOf<HTMLElement> = page.querySelectorAll(".NavContent");
        if (tables.length > 0) {
          const primaryTable = tables[0].firstElementChild as HTMLTableElement;
          filterVosotrosTable(primaryTable);
          const presentIndicative = primaryTable.rows[8];
          const piForms = Array.from(presentIndicative.querySelectorAll("span")).map((i) => i.innerText);
          if (piForms.length === 5) {
            piForms.splice(1, 0, piForms[1]);
          }

          const piTable = buildTable(["yo", "tú", "vos", "él", "nosotros", "ustedes"], piForms);
          left.appendChild(piTable);
        }

        // Load into page
        loader.remove();
        spanishSection.forEach((el) => content.appendChild(el));
        document.title = `${query} | Spanish`;

        // Debug
        console.log(tables);
      });
  });
});
