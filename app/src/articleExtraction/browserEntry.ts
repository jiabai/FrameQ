// SPDX-License-Identifier: MIT
import { extractArticle } from "./extractArticle";

declare global {
  var __appExtractArticle: typeof extractArticle;
}

globalThis.__appExtractArticle = extractArticle;
