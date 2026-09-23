// Searchable city picker: a combobox over /api/places, following the WAI-ARIA
// combobox pattern (arrow keys, Enter, Escape; screen readers hear the options).

export interface ApiPlace {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  timeZone: string;
  population: number;
}

export const placeLabel = (p: ApiPlace) => `${p.name}, ${p.country}`;
const placeDetail = (p: ApiPlace) => [p.name, p.region !== p.name ? p.region : "", p.country].filter(Boolean).join(", ");

export function createPlacePicker(input: HTMLInputElement, list: HTMLUListElement, onPick: (p: ApiPlace) => void) {
  let options: ApiPlace[] = [];
  let active = -1;
  let chosenLabel = input.value;
  let timer = 0;
  let request: AbortController | null = null;

  const open = (isOpen: boolean) => {
    list.hidden = !isOpen;
    input.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) input.removeAttribute("aria-activedescendant");
  };

  const highlight = (i: number) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", `place-option-${i}`);
      list.children[i]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  const choose = (p: ApiPlace) => {
    chosenLabel = placeLabel(p);
    input.value = chosenLabel;
    open(false);
    onPick(p);
  };

  const render = (message?: string) => {
    list.replaceChildren();
    if (message) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = message;
      list.append(li);
    }
    options.forEach((p, i) => {
      const li = document.createElement("li");
      li.id = `place-option-${i}`;
      li.setAttribute("role", "option");
      li.textContent = placeDetail(p);
      // mousedown, not click: fires before the input's blur closes the list
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(p);
      });
      list.append(li);
    });
    highlight(options.length ? 0 : -1);
    open(true);
  };

  const search = async (q: string) => {
    request?.abort();
    if (q.trim().length < 2) {
      options = [];
      open(false);
      return;
    }
    request = new AbortController();
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: request.signal });
      options = (await res.json()).places ?? [];
      render(options.length ? undefined : "No matching city. Try a nearby larger town.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        options = [];
        render("City search is unavailable right now.");
      }
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => search(input.value), 150);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden) {
        if (options.length) render();
        return;
      }
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      highlight((active + step + options.length) % Math.max(options.length, 1));
    } else if (e.key === "Enter") {
      if (!list.hidden) {
        e.preventDefault(); // pick the city rather than submitting the form
        if (options[active]) choose(options[active]);
      }
    } else if (e.key === "Escape") {
      if (!list.hidden) e.preventDefault();
      input.value = chosenLabel;
      open(false);
    }
  });

  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", () => {
    open(false);
    input.value = chosenLabel; // typed text without a pick doesn't change the place
  });

  return {
    /** Show a label without opening the list (initial place, "My location"). */
    setLabel(label: string) {
      chosenLabel = label;
      input.value = label;
    },
  };
}
