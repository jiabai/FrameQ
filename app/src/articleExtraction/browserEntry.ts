// SPDX-License-Identifier: MIT
import { extractArticle } from "./extractArticle";

declare global {
  var __frameqExtractArticle: typeof extractArticle;
}

globalThis.__frameqExtractArticle = extractArticle;
