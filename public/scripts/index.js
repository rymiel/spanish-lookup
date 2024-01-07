function constructURL(query) {
  const encoded = encodeURIComponent(query);
  return `https://en.wiktionary.org/w/api.php?action=parse&page=${encoded}&prop=text&formatversion=2&origin=*&format=json`;
}

addEventListener("load", () => {
  const form = document.getElementById("form");
  const queryBox = document.getElementById("query");
  const content = document.getElementById("content");
  const left = document.getElementById("leftMain");

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

        const spanishHeaderText = page.querySelector("h2 span#Spanish");
        const spanishHeader = spanishHeaderText.parentElement;

        /** @type {Element[]} */
        const spanishSection = [];

        // we don't need "Spanish" at the top of the page, we already know it's spanish!
        // spanishSection.push(spanishHeader);

        // But I will add a h1 header to show the currently made search
        const searchHeader = document.createElement("h1");
        searchHeader.innerText = query;
        spanishSection.push(searchHeader);

        /** @type {HTMLElement?} */
        let nextHeader = spanishHeader.nextElementSibling;
        while (nextHeader !== null && nextHeader.nodeName !== "H2") {
          spanishSection.push(nextHeader);
          nextHeader = nextHeader.nextElementSibling;
        }

        spanishSection.forEach((el) => spanishPage.appendChild(el));
        page = spanishPage;

        /** @type {HTMLElement} */
        const pronuncationTitle = spanishSection.find(
          (el) => el.nodeName == "H3" && el.innerText == "Pronunciation"
        );
        if (pronuncationTitle) {
          /** @type {HTMLElement} */
          const pronuncationSection = pronuncationTitle.nextElementSibling;
          /** @type {HTMLElement[]} */
          let pronuncationEntries = Array.from(
            pronuncationSection.querySelectorAll("li")
          ).filter((el) => el.innerText.startsWith("IPA"));
          /** @type {HTMLElement[]} */
          const switcherEntries = Array.from(
            page.querySelectorAll(".vsSwitcher > .vsHide > ul > li")
          );

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
                  return (
                    inner.includes("(Buenos Aires and environs)") ||
                    inner.includes("(Latin America)")
                  );
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
            let pronuncationText = parts[parts.length - 1].trim();
            if (pronuncationText.startsWith(":")) {
              pronuncationText = pronuncationText.substring(1).trim();
            }

            // Remove the whole Pronuncation section
            let i = spanishSection.indexOf(pronuncationTitle);
            spanishSection.splice(i, 1);
            while (spanishSection[i].nodeName != "H3") {
              spanishSection.splice(i, 1);
            }

            // Put the pronuncation directly in the title
            searchHeader.innerText = `<${query}> ${pronuncationText}`;
          }
        }

        /** @param {string} s */
        /** @returns {[number, number, number]} */
        const rgb = (s) =>
          s
            .substring(4, s.length - 1)
            .split(", ")
            .map((i) => parseInt(i));

        /** @param {[number, number, number]} n */
        const unrgb = (n) => `rgb(${n.join(", ")})`;

        /** @param {HTMLElement} el */
        const filterColors = (el) => {
          const bg = el.style.backgroundColor;
          if (bg !== "") {
            const inverted = rgb(bg).map((i) => 255 - i);
            el.style.backgroundColor = unrgb(inverted);
          }
          Array.from(el.children).forEach((i) => filterColors(i));
        };

        filterColors(page);

        const vosotrosFilterColumns = [
          1, 1, 1, 0, 0, 2, 4, 6, 5, 5, 5, 5, 5, 0, 6, 5, 5, 5, 5, 0, 6, 5, 5,
        ];

        /** @param {HTMLTableRowElement} row */
        const filterVosotrosRow = (row) => {
          const cells = row.cells;
          const idx = row.rowIndex;

          const decIndex = vosotrosFilterColumns[idx];
          if (cells[decIndex].colSpan === 1) {
            cells[decIndex].remove();
          } else {
            cells[decIndex].colSpan -= 1;
          }
        };

        /** @param {HTMLTableElement} table */
        const filterVosotrosTable = (table) => {
          for (const i of table.rows) {
            filterVosotrosRow(i);
          }
        };

        const buildTable = (a, b) => {
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
        const tables = page.querySelectorAll(".NavContent");
        if (tables.length > 0) {
          /** @type {HTMLTableElement} */
          const primaryTable = tables[0].firstElementChild;
          filterVosotrosTable(primaryTable);
          const presentIndicative = primaryTable.rows[8];
          const piForms = Array.from(
            presentIndicative.querySelectorAll("td > span")
          ).map((i) => i.innerText);
          if (piForms.length === 5) {
            piForms.splice(1, 0, piForms[1]);
          }

          const piTable = buildTable(
            ["yo", "tú", "vos", "él", "nosotros", "ustedes"],
            piForms
          );
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
