export function parseCsvText(input: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  const pushField = () => {
    currentRow.push(currentField.trim());
    currentField = "";
  };

  const pushRow = () => {
    if (currentRow.length === 0 && currentField === "") return;
    pushField();
    rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === "," || char === "\t")) {
      pushField();
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }

    currentField += char;
  }

  pushRow();

  return rows.filter((row) => row.some((field) => field.length > 0));
}
