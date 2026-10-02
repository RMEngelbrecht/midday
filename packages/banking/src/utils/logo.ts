import { getStorage, objectKey } from "@midday/storage";

/** Public URL of an institution logo in the `institutions` storage bucket. */
export function getLogoURL(id: string, ext?: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripped on purpose
  const name = `${id.replace(/[/\\\u0000-\u001f]/g, "_")}.${ext || "jpg"}`;
  return getStorage().publicUrl(objectKey("institutions", name));
}

export function getFileExtension(url: string) {
  return url.split(".").at(-1);
}
