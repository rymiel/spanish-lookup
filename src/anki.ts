const ANKI_VERSION = 6;

type AnkiOk<T> = { result: T; error: null };
type AnkiError = { result: null; error: string };
type AnkiResponse<T> = AnkiOk<T> | AnkiError;
type AnkiPermissionResponse = { permission: "granted" | "denied" };

async function invoke<T = object>(action: string, params: object = {}): Promise<T> {
  const i = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    body: JSON.stringify({
      action,
      params,
      version: ANKI_VERSION,
    }),
  });
  const json = (await i.json()) as AnkiResponse<T>;
  if (json.error) {
    throw json.error;
  }
  return json.result as T; // why, ts?
}

export function requestAnkiPermission() {
  invoke<AnkiPermissionResponse>("requestPermission").then((i) => console.log(`Anki permission ${i.permission}`));
}

async function canAddHeadword(headwords: NodeListOf<HTMLElement>): Promise<boolean> {
  if (headwords.length === 0) {
    return false;
  }

  try {
    const ids = await invoke<number[]>("findNotes", {
      query: `"deck:Words from textbook" "Expression:${headwords[0].innerText}"`,
    });
    return ids.length === 0;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function makeAddButton(headword: HTMLElement, meaning: string, notes: string) {
  const link = document.createElement("input");
  link.type = "button";
  link.value = "+";
  link.addEventListener("click", () => {
    invoke("guiAddCards", {
      note: {
        deckName: "Words from textbook",
        modelName: "Basic+Spanish",
        fields: {
          Expression: headword.innerText,
          Meaning: meaning,
          Notes: notes,
        },
        tags: ["connect"],
      },
    });
  });
  return link;
}

export function addAnkiButtons(page: HTMLElement) {
  const headwords = page.querySelectorAll<HTMLElement>(".headword");
  const shouldAddButtons = canAddHeadword(headwords);

  headwords.forEach((headword) => {
    const headwordLine = headword.parentElement!;
    const headwordParagraph = headwordLine.parentElement!;
    const previousHeaderContainer = headwordParagraph.previousElementSibling;
    let previousHeader = previousHeaderContainer?.firstElementChild as HTMLElement | null;
    if (previousHeader?.nodeName !== "H3" && previousHeader?.nodeName !== "H4") previousHeader = null;
    const gender = headwordLine?.querySelector(".gender");
    const list = headwordParagraph?.nextElementSibling;
    if (!headwordLine || !headwordParagraph || !list) return;
    if (list.nodeName !== "OL") return;
    const firstEntry = list.firstElementChild as HTMLElement | null;
    const primaryMeaning = firstEntry?.textContent?.split("\n")[0];
    if (!primaryMeaning) return;

    const notes = [previousHeader?.innerText.toLowerCase() ?? undefined, gender?.textContent ?? undefined]
      .filter((i) => i !== undefined)
      .join(" ");
    const button = makeAddButton(headword, primaryMeaning, notes);
    shouldAddButtons.then((canAdd) => {
      if (canAdd) {
        headwordLine.insertBefore(button, headword);
      }
    });
  });
}
