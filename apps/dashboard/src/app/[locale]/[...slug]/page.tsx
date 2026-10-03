import { notFound } from "next/navigation";

// Unknown paths under the locale segment render the real not-found page (404).
export default function CatchAllPage() {
  notFound();
}
