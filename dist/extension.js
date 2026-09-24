import { createRequire as __pistatuslineCreateRequire } from 'node:module';
import { fileURLToPath as __pistatuslineFileURLToPath } from 'node:url';
import { dirname as __pistatuslineDirname } from 'node:path';
const require = __pistatuslineCreateRequire(import.meta.url);
const __filename = __pistatuslineFileURLToPath(import.meta.url);
const __dirname = __pistatuslineDirname(__filename);

// src/pi/extension.ts
import * as path2 from "node:path";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";
import { Worker } from "node:worker_threads";
import {
  getAgentDir,
  readStoredCredential,
  VERSION
} from "@earendil-works/pi-coding-agent";

// node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST2 = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][^\\u0007\\u001B\\u009C]*${ST2})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? void 0 : "g");
}

// node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  if (!string.includes("\x1B") && !string.includes("\x9B")) {
    return string;
  }
  return string.replace(regex, "");
}

// node_modules/get-east-asian-width/lookup-data.js
var ambiguousMinimalCodePoint = 161;
var ambiguousMaximumCodePoint = 1114109;
var ambiguousRanges = [161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180, 182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225, 230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250, 252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283, 294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324, 328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462, 464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474, 476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715, 717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879, 913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103, 1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226, 8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254, 8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453, 8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491, 8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601, 8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707, 8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730, 8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759, 8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807, 8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857, 8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587, 9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655, 9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701, 9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758, 9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837, 9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953, 9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980, 9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743, 65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373, 127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109];
var fullwidthMinimalCodePoint = 12288;
var fullwidthMaximumCodePoint = 65510;
var fullwidthRanges = [12288, 12288, 65281, 65376, 65504, 65510];
var wideMinimalCodePoint = 4352;
var wideMaximumCodePoint = 262141;
var wideRanges = [4352, 4447, 8986, 8987, 9001, 9002, 9193, 9196, 9200, 9200, 9203, 9203, 9725, 9726, 9748, 9749, 9776, 9783, 9800, 9811, 9855, 9855, 9866, 9871, 9875, 9875, 9889, 9889, 9898, 9899, 9917, 9918, 9924, 9925, 9934, 9934, 9940, 9940, 9962, 9962, 9970, 9971, 9973, 9973, 9978, 9978, 9981, 9981, 9989, 9989, 9994, 9995, 10024, 10024, 10060, 10060, 10062, 10062, 10067, 10069, 10071, 10071, 10133, 10135, 10160, 10160, 10175, 10175, 11035, 11036, 11088, 11088, 11093, 11093, 11904, 11929, 11931, 12019, 12032, 12245, 12272, 12287, 12289, 12350, 12353, 12438, 12441, 12543, 12549, 12591, 12593, 12686, 12688, 12773, 12783, 12830, 12832, 12871, 12880, 42124, 42128, 42182, 43360, 43388, 44032, 55203, 63744, 64255, 65040, 65049, 65072, 65106, 65108, 65126, 65128, 65131, 94176, 94180, 94192, 94198, 94208, 101589, 101631, 101662, 101760, 101874, 110576, 110579, 110581, 110587, 110589, 110590, 110592, 110882, 110898, 110898, 110928, 110930, 110933, 110933, 110948, 110951, 110960, 111355, 119552, 119638, 119648, 119670, 126980, 126980, 127183, 127183, 127374, 127374, 127377, 127386, 127488, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127584, 127589, 127744, 127776, 127789, 127797, 127799, 127868, 127870, 127891, 127904, 127946, 127951, 127955, 127968, 127984, 127988, 127988, 127992, 128062, 128064, 128064, 128066, 128252, 128255, 128317, 128331, 128334, 128336, 128359, 128378, 128378, 128405, 128406, 128420, 128420, 128507, 128591, 128640, 128709, 128716, 128716, 128720, 128722, 128725, 128728, 128732, 128735, 128747, 128748, 128756, 128764, 128992, 129003, 129008, 129008, 129292, 129338, 129340, 129349, 129351, 129535, 129648, 129660, 129664, 129674, 129678, 129734, 129736, 129736, 129741, 129756, 129759, 129770, 129775, 129784, 131072, 196605, 196608, 262141];

// node_modules/get-east-asian-width/utilities.js
var isInRange = (ranges, codePoint) => {
  let low = 0;
  let high = Math.floor(ranges.length / 2) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const i = mid * 2;
    if (codePoint < ranges[i]) {
      high = mid - 1;
    } else if (codePoint > ranges[i + 1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
};

// node_modules/get-east-asian-width/lookup.js
var commonCjkCodePoint = 19968;
var [wideFastPathStart, wideFastPathEnd] = /* @__PURE__ */ findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
  let fastPathStart = ranges[0];
  let fastPathEnd = ranges[1];
  for (let index = 0; index < ranges.length; index += 2) {
    const start = ranges[index];
    const end = ranges[index + 1];
    if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) {
      return [start, end];
    }
    if (end - start > fastPathEnd - fastPathStart) {
      fastPathStart = start;
      fastPathEnd = end;
    }
  }
  return [fastPathStart, fastPathEnd];
}
var isAmbiguous = (codePoint) => {
  if (codePoint < ambiguousMinimalCodePoint || codePoint > ambiguousMaximumCodePoint) {
    return false;
  }
  return isInRange(ambiguousRanges, codePoint);
};
var isFullWidth = (codePoint) => {
  if (codePoint < fullwidthMinimalCodePoint || codePoint > fullwidthMaximumCodePoint) {
    return false;
  }
  return isInRange(fullwidthRanges, codePoint);
};
var isWide = (codePoint) => {
  if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
    return true;
  }
  if (codePoint < wideMinimalCodePoint || codePoint > wideMaximumCodePoint) {
    return false;
  }
  return isInRange(wideRanges, codePoint);
};

// node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// node_modules/string-width/index.js
var segmenter = new Intl.Segmenter();
var zeroWidthClusterRegex = new RegExp("^(?:\\p{Default_Ignorable_Code_Point}|\\p{Control}|\\p{Format}|\\p{Nonspacing_Mark}|\\p{Enclosing_Mark}|\\p{Surrogate})+$", "v");
var leadingNonPrintingRegex = new RegExp("^[\\p{Default_Ignorable_Code_Point}\\p{Control}\\p{Format}\\p{Nonspacing_Mark}\\p{Enclosing_Mark}\\p{Surrogate}]+", "v");
var spacingMarkRegex = new RegExp("\\p{Spacing_Mark}", "v");
var rgiEmojiRegex = new RegExp("^\\p{RGI_Emoji}$", "v");
var unqualifiedKeycapRegex = /^[\d#*]\u20E3$/;
var extendedPictographicRegex = new RegExp("\\p{Extended_Pictographic}", "gu");
function isDoubleWidthNonRgiEmojiSequence(segment) {
  if (segment.length > 50) {
    return false;
  }
  if (unqualifiedKeycapRegex.test(segment)) {
    return true;
  }
  if (segment.includes("\u200D")) {
    const pictographics = segment.match(extendedPictographicRegex);
    return pictographics !== null && pictographics.length >= 2;
  }
  return false;
}
function baseVisible(segment) {
  return segment.replace(leadingNonPrintingRegex, "");
}
function isZeroWidthCluster(segment) {
  return zeroWidthClusterRegex.test(segment);
}
function isHangulLeadingJamo(codePoint) {
  return codePoint >= 4352 && codePoint <= 4447 || codePoint >= 43360 && codePoint <= 43388;
}
function isHangulVowelJamo(codePoint) {
  return codePoint >= 4448 && codePoint <= 4519 || codePoint >= 55216 && codePoint <= 55238;
}
function isHangulTrailingJamo(codePoint) {
  return codePoint >= 4520 && codePoint <= 4607 || codePoint >= 55243 && codePoint <= 55291;
}
function isHangulJamo(codePoint) {
  return isHangulLeadingJamo(codePoint) || isHangulVowelJamo(codePoint) || isHangulTrailingJamo(codePoint);
}
function hangulClusterWidth(visibleSegment, eastAsianWidthOptions) {
  const codePoints = [];
  for (const character of visibleSegment) {
    if (zeroWidthClusterRegex.test(character)) {
      continue;
    }
    codePoints.push(character.codePointAt(0));
  }
  if (codePoints.length === 0) {
    return void 0;
  }
  let width = 0;
  for (let index = 0; index < codePoints.length; index++) {
    const codePoint = codePoints[index];
    if (!isHangulJamo(codePoint)) {
      if (width === 0) {
        return void 0;
      }
      for (let remaining = index; remaining < codePoints.length; remaining++) {
        width += eastAsianWidth(codePoints[remaining], eastAsianWidthOptions);
      }
      return width;
    }
    if (isHangulLeadingJamo(codePoint) && isHangulVowelJamo(codePoints[index + 1])) {
      width += 2;
      index += isHangulTrailingJamo(codePoints[index + 2]) ? 2 : 1;
      continue;
    }
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
  }
  return width;
}
function trailingWidth(visibleSegment, eastAsianWidthOptions) {
  let extra = 0;
  let first = true;
  for (const character of visibleSegment) {
    if (first) {
      first = false;
      continue;
    }
    if (spacingMarkRegex.test(character) || character >= "\uFF00" && character <= "\uFFEF") {
      extra += eastAsianWidth(character.codePointAt(0), eastAsianWidthOptions);
    }
  }
  return extra;
}
function stringWidth(input, options = {}) {
  if (typeof input !== "string" || input.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  let string = input;
  if (!countAnsiEscapeCodes && (string.includes("\x1B") || string.includes("\x9B"))) {
    string = stripAnsi(string);
  }
  if (string.length === 0) {
    return 0;
  }
  if (/^[\u0020-\u007E]*$/.test(string)) {
    return string.length;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment } of segmenter.segment(string)) {
    if (isZeroWidthCluster(segment)) {
      continue;
    }
    if (rgiEmojiRegex.test(segment) || isDoubleWidthNonRgiEmojiSequence(segment)) {
      width += 2;
      continue;
    }
    const visibleSegment = baseVisible(segment);
    const hangulWidth = hangulClusterWidth(visibleSegment, eastAsianWidthOptions);
    if (hangulWidth !== void 0) {
      width += hangulWidth;
      continue;
    }
    const codePoint = visibleSegment.codePointAt(0);
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
    width += trailingWidth(visibleSegment, eastAsianWidthOptions);
  }
  return width;
}

// src/utils/ansi.ts
var ESC = "\x1B";
var BEL = "\x07";
var C1_CSI = "\x9B";
var C1_OSC = "\x9D";
var ST = "\x9C";
var ZERO_WIDTH_JOINER = 8205;
var COMBINING_ENCLOSING_KEYCAP = 8419;
var VARIATION_SELECTOR_START = 65024;
var VARIATION_SELECTOR_END = 65039;
var VARIATION_SELECTOR_SUPPLEMENT_START = 917760;
var VARIATION_SELECTOR_SUPPLEMENT_END = 917999;
var REGIONAL_INDICATOR_START = 127462;
var REGIONAL_INDICATOR_END = 127487;
var EXTENDED_PICTOGRAPHIC_REGEX = createUnicodePropertyRegex("\\p{Extended_Pictographic}");
var EMOJI_PRESENTATION_REGEX = createUnicodePropertyRegex("\\p{Emoji_Presentation}");
var EMOJI_MODIFIER_REGEX = createUnicodePropertyRegex("\\p{Emoji_Modifier}");
var COMBINING_MARK_REGEX = createUnicodePropertyRegex("\\p{Mark}");
function createUnicodePropertyRegex(pattern) {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return null;
  }
}
function matchesUnicodeProperty(character, regex2) {
  return regex2?.test(character) ?? false;
}
function isVariationSelector(codePoint) {
  return codePoint >= VARIATION_SELECTOR_START && codePoint <= VARIATION_SELECTOR_END || codePoint >= VARIATION_SELECTOR_SUPPLEMENT_START && codePoint <= VARIATION_SELECTOR_SUPPLEMENT_END;
}
function isRegionalIndicator(codePoint) {
  return codePoint >= REGIONAL_INDICATOR_START && codePoint <= REGIONAL_INDICATOR_END;
}
function consumeDisplayCluster(text, start) {
  const firstCodePoint = text.codePointAt(start);
  if (firstCodePoint === void 0) {
    return null;
  }
  const firstCharacter = String.fromCodePoint(firstCodePoint);
  let cluster = firstCharacter;
  let index = start + firstCharacter.length;
  if (isRegionalIndicator(firstCodePoint)) {
    const nextCodePoint = text.codePointAt(index);
    if (nextCodePoint !== void 0 && isRegionalIndicator(nextCodePoint)) {
      const nextCharacter = String.fromCodePoint(nextCodePoint);
      cluster += nextCharacter;
      index += nextCharacter.length;
    }
    return {
      text: cluster,
      nextIndex: index
    };
  }
  while (index < text.length) {
    const nextCodePoint = text.codePointAt(index);
    if (nextCodePoint === void 0) {
      break;
    }
    const nextCharacter = String.fromCodePoint(nextCodePoint);
    if (isVariationSelector(nextCodePoint) || nextCodePoint === COMBINING_ENCLOSING_KEYCAP || matchesUnicodeProperty(nextCharacter, COMBINING_MARK_REGEX) || matchesUnicodeProperty(nextCharacter, EMOJI_MODIFIER_REGEX)) {
      cluster += nextCharacter;
      index += nextCharacter.length;
      continue;
    }
    if (nextCodePoint === ZERO_WIDTH_JOINER) {
      cluster += nextCharacter;
      index += nextCharacter.length;
      const joinedCodePoint = text.codePointAt(index);
      if (joinedCodePoint === void 0) {
        break;
      }
      const joinedCharacter = String.fromCodePoint(joinedCodePoint);
      cluster += joinedCharacter;
      index += joinedCharacter.length;
      continue;
    }
    break;
  }
  return {
    text: cluster,
    nextIndex: index
  };
}
function isZeroWidthStandaloneCluster(cluster) {
  const characters = Array.from(cluster);
  return characters.length > 0 && characters.every((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === void 0) {
      return false;
    }
    return codePoint === ZERO_WIDTH_JOINER || codePoint === COMBINING_ENCLOSING_KEYCAP || isVariationSelector(codePoint) || matchesUnicodeProperty(character, COMBINING_MARK_REGEX) || matchesUnicodeProperty(character, EMOJI_MODIFIER_REGEX);
  });
}
function shouldTreatClusterAsNarrowTextPictograph(cluster) {
  if (stringWidth(cluster) <= 1) {
    return false;
  }
  const characters = Array.from(cluster);
  if (characters.length === 0) {
    return false;
  }
  for (const character of characters) {
    const codePoint = character.codePointAt(0);
    if (codePoint === void 0) {
      continue;
    }
    if (codePoint === ZERO_WIDTH_JOINER || codePoint === COMBINING_ENCLOSING_KEYCAP || isVariationSelector(codePoint) || isRegionalIndicator(codePoint) || matchesUnicodeProperty(character, EMOJI_PRESENTATION_REGEX) || matchesUnicodeProperty(character, EMOJI_MODIFIER_REGEX)) {
      return false;
    }
  }
  return characters.some((character) => matchesUnicodeProperty(character, EXTENDED_PICTOGRAPHIC_REGEX));
}
function getClusterWidth(cluster) {
  if (cluster.length === 0 || isZeroWidthStandaloneCluster(cluster)) {
    return 0;
  }
  if (shouldTreatClusterAsNarrowTextPictograph(cluster)) {
    return 1;
  }
  return stringWidth(cluster);
}
function getTextDisplayWidth(text) {
  let width = 0;
  let index = 0;
  while (index < text.length) {
    const cluster = consumeDisplayCluster(text, index);
    if (!cluster) {
      break;
    }
    width += getClusterWidth(cluster.text);
    index = cluster.nextIndex;
  }
  return width;
}
function isCsiFinalByte(codePoint) {
  return codePoint >= 64 && codePoint <= 126;
}
function parseCsi(input, start, bodyStart) {
  let index = bodyStart;
  while (index < input.length) {
    const codePoint = input.charCodeAt(index);
    if (isCsiFinalByte(codePoint)) {
      const end = index + 1;
      return {
        nextIndex: end,
        sequence: input.slice(start, end)
      };
    }
    index++;
  }
  return {
    nextIndex: input.length,
    sequence: input.slice(start)
  };
}
function getOsc8Action(body) {
  if (!body.startsWith("8;")) {
    return void 0;
  }
  const urlStart = body.indexOf(";", 2);
  if (urlStart === -1) {
    return void 0;
  }
  const url = body.slice(urlStart + 1);
  return url.length > 0 ? "open" : "close";
}
function parseOsc(input, start, bodyStart) {
  let index = bodyStart;
  while (index < input.length) {
    const current = input[index];
    if (!current) {
      break;
    }
    if (current === BEL) {
      const end = index + 1;
      const body = input.slice(bodyStart, index);
      return {
        nextIndex: end,
        sequence: input.slice(start, end),
        osc8Action: getOsc8Action(body),
        osc8Terminator: "bel"
      };
    }
    if (current === ST) {
      const end = index + 1;
      const body = input.slice(bodyStart, index);
      return {
        nextIndex: end,
        sequence: input.slice(start, end),
        osc8Action: getOsc8Action(body),
        osc8Terminator: "st"
      };
    }
    if (current === ESC && input[index + 1] === "\\") {
      const end = index + 2;
      const body = input.slice(bodyStart, index);
      return {
        nextIndex: end,
        sequence: input.slice(start, end),
        osc8Action: getOsc8Action(body),
        osc8Terminator: "st"
      };
    }
    index++;
  }
  return {
    nextIndex: input.length,
    sequence: input.slice(start)
  };
}
function parseEscapeSequence(input, index) {
  const current = input[index];
  if (!current) {
    return null;
  }
  if (current === ESC) {
    const next = input[index + 1];
    if (next === "[") {
      return parseCsi(input, index, index + 2);
    }
    if (next === "]") {
      return parseOsc(input, index, index + 2);
    }
    if (next) {
      return {
        nextIndex: index + 2,
        sequence: input.slice(index, index + 2)
      };
    }
    return {
      nextIndex: input.length,
      sequence: current
    };
  }
  if (current === C1_CSI) {
    return parseCsi(input, index, index + 1);
  }
  if (current === C1_OSC) {
    return parseOsc(input, index, index + 1);
  }
  return null;
}
function getOsc8CloseSequence(terminator) {
  if (terminator === "bel") {
    return `${ESC}]8;;${BEL}`;
  }
  return `${ESC}]8;;${ESC}\\`;
}
function getVisibleText(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const escape = parseEscapeSequence(text, index);
    if (escape) {
      index = escape.nextIndex;
      continue;
    }
    const codePoint = text.codePointAt(index);
    if (codePoint === void 0) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    result += character;
    index += character.length;
  }
  return result;
}
function getVisibleWidth(text) {
  return getTextDisplayWidth(getVisibleText(text));
}
function truncateStyledText(text, maxWidth, options = {}) {
  if (maxWidth <= 0) {
    return "";
  }
  if (getVisibleWidth(text) <= maxWidth) {
    return text;
  }
  const addEllipsis = options.ellipsis ?? true;
  const ellipsis = addEllipsis ? "..." : "";
  const ellipsisWidth = addEllipsis ? stringWidth(ellipsis) : 0;
  if (addEllipsis && maxWidth <= ellipsisWidth) {
    return ".".repeat(maxWidth);
  }
  const targetWidth = Math.max(0, maxWidth - ellipsisWidth);
  let output = "";
  let currentWidth = 0;
  let index = 0;
  let didTruncate = false;
  let openOsc8Terminator = null;
  while (index < text.length) {
    const escape = parseEscapeSequence(text, index);
    if (escape) {
      output += escape.sequence;
      index = escape.nextIndex;
      if (escape.osc8Action === "open") {
        openOsc8Terminator = escape.osc8Terminator ?? "st";
      } else if (escape.osc8Action === "close") {
        openOsc8Terminator = null;
      }
      continue;
    }
    let visibleSegmentEnd = index;
    while (visibleSegmentEnd < text.length && !parseEscapeSequence(text, visibleSegmentEnd)) {
      const codePoint = text.codePointAt(visibleSegmentEnd);
      if (codePoint === void 0) {
        break;
      }
      visibleSegmentEnd += String.fromCodePoint(codePoint).length;
    }
    const visibleSegment = text.slice(index, visibleSegmentEnd);
    const cluster = consumeDisplayCluster(visibleSegment, 0);
    if (!cluster) {
      break;
    }
    const clusterWidth = getClusterWidth(cluster.text);
    if (currentWidth + clusterWidth > targetWidth) {
      didTruncate = true;
      break;
    }
    output += cluster.text;
    currentWidth += clusterWidth;
    index += cluster.text.length;
  }
  if (!didTruncate) {
    return text;
  }
  if (openOsc8Terminator) {
    output += getOsc8CloseSequence(openOsc8Terminator);
  }
  return output + ellipsis;
}

// src/pi/adapter.ts
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function entryUsage(entry) {
  return entry.type === "message" ? entry.message?.usage : entry.usage;
}
function buildStatusJson(snapshot) {
  const totalCost = snapshot.allEntries.reduce((sum, entry) => sum + finite(entryUsage(entry)?.cost?.total), 0);
  const status = {
    session_id: snapshot.sessionId,
    cwd: snapshot.cwd,
    workspace: { current_dir: snapshot.cwd, project_dir: snapshot.cwd },
    version: snapshot.piVersion,
    cost: {
      total_cost_usd: totalCost,
      ...snapshot.sessionStartMs === null ? {} : { total_duration_ms: Math.max(0, snapshot.nowMs - snapshot.sessionStartMs) }
    }
  };
  if (snapshot.model) {
    status.model = { id: snapshot.model.id, display_name: snapshot.model.name ?? snapshot.model.id };
  }
  if (snapshot.thinkingLevel) {
    status.effort = { level: snapshot.thinkingLevel };
  }
  if (snapshot.context) {
    status.context_window = {
      context_window_size: snapshot.context.contextWindow,
      ...snapshot.context.tokens === null ? {} : { current_usage: snapshot.context.tokens },
      ...snapshot.context.percent === null ? {} : { used_percentage: snapshot.context.percent }
    };
  }
  return status;
}
function toTokenUsage(usage) {
  return {
    input_tokens: finite(usage.input),
    output_tokens: finite(usage.output),
    cache_read_input_tokens: finite(usage.cacheRead),
    cache_creation_input_tokens: finite(usage.cacheWrite)
  };
}
function toTranscriptRecords(entries) {
  const records = [];
  for (const entry of entries) {
    const { timestamp } = entry;
    if (entry.type === "message") {
      const role = entry.message?.role;
      if (role === "user") {
        records.push({ type: "user", timestamp });
      } else if (role === "assistant" && entry.message?.usage) {
        records.push({
          type: "assistant",
          timestamp,
          isApiErrorMessage: entry.message.stopReason === "error",
          message: { usage: toTokenUsage(entry.message.usage), stop_reason: entry.message.stopReason ?? "stop" }
        });
      }
      continue;
    }
    if (entry.type === "compaction") {
      records.push({
        type: "system",
        subtype: "compact_boundary",
        timestamp,
        compactMetadata: { preTokens: entry.tokensBefore }
      });
    }
    if (entry.usage && (entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "usage")) {
      records.push({
        type: "assistant",
        timestamp,
        isSidechain: true,
        message: { usage: toTokenUsage(entry.usage), stop_reason: "stop" }
      });
    }
  }
  return records;
}

// src/pi/state.ts
import * as fs from "fs";
import * as path from "path";
var DEFAULT_STATE = { enabled: true, refreshInterval: 10 };
function readState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_STATE.enabled,
      refreshInterval: raw.refreshInterval === null || typeof raw.refreshInterval === "number" ? raw.refreshInterval : DEFAULT_STATE.refreshInterval
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(temp, file);
}

// src/pi/usage.ts
var ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
var REQUEST_TIMEOUT_MS = 5e3;
function errorFor(error) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "api-error";
}
function anthropicUsageSource(getOAuthToken) {
  return {
    providers: ["anthropic"],
    refreshMs: 18e4,
    // ccstatusline's usage cache age
    async fetch() {
      const token = await getOAuthToken();
      if (!token) {
        return null;
      }
      try {
        const response = await fetch(ANTHROPIC_USAGE_URL, {
          headers: { "Authorization": `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
          return { error: response.status === 429 ? "rate-limited" : "api-error" };
        }
        return { anthropicJson: await response.text() };
      } catch (error) {
        return { error: errorFor(error) };
      }
    }
  };
}
var OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
function goWindow(window) {
  const percent = window?.percent;
  const resetsAt = window?.resetsAt;
  if (typeof percent !== "number" || !Number.isFinite(percent) || typeof resetsAt !== "string") {
    return null;
  }
  return { percent: window?.status === "rate-limited" ? 100 : Math.max(0, percent), resetsAt };
}
function parseOpencodeGoUsage(json) {
  const usage = json?.usage;
  const rolling = goWindow(usage?.rolling);
  const weekly = goWindow(usage?.weekly);
  if (!rolling && !weekly) {
    return null;
  }
  return {
    ...rolling ? { sessionUsage: rolling.percent, sessionResetAt: rolling.resetsAt } : {},
    ...weekly ? { weeklyUsage: weekly.percent, weeklyResetAt: weekly.resetsAt } : {}
  };
}
function opencodeGoUsageSource(getApiKey) {
  return {
    providers: ["opencode-go"],
    refreshMs: 6e4,
    async fetch() {
      const key = await getApiKey();
      if (!key) {
        return null;
      }
      try {
        const response = await fetch(OPENCODE_GO_USAGE_URL, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
          return { error: response.status === 429 ? "rate-limited" : "api-error" };
        }
        return parseOpencodeGoUsage(await response.json().catch(() => null)) ?? { error: "parse-error" };
      } catch (error) {
        return { error: errorFor(error) };
      }
    }
  };
}
var PlanUsage = class {
  constructor(sources, onChange) {
    this.sources = sources;
    this.onChange = onChange;
  }
  data = /* @__PURE__ */ new Map();
  timers = /* @__PURE__ */ new Map();
  started = false;
  disposed = false;
  /** Starts polling; called only once a configured line actually has a usage widget. */
  start() {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    for (const source of this.sources) {
      const poll = async () => {
        const next = await source.fetch().catch(() => null);
        if (this.disposed) {
          return;
        }
        if (JSON.stringify(next) !== JSON.stringify(this.data.get(source) ?? null)) {
          this.data.set(source, next);
          this.onChange();
        }
        const timer = setTimeout(() => {
          void poll();
        }, source.refreshMs);
        timer.unref?.();
        this.timers.set(source, timer);
      };
      void poll();
    }
  }
  get(activeProvider) {
    return selectUsage(this.sources.map((source) => ({ providers: source.providers, data: this.data.get(source) ?? null })), activeProvider);
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
  }
};
function selectUsage(entries, activeProvider) {
  const matching = entries.find((entry) => entry.data && activeProvider !== void 0 && entry.providers.includes(activeProvider));
  return matching?.data ?? entries.find((entry) => entry.data && !entry.data.error)?.data ?? entries.find((entry) => entry.data)?.data ?? null;
}

// src/pi/extension.ts
var DIST_DIR = path2.dirname(fileURLToPath(import.meta.url));
var RENDER_DEBOUNCE_MS = 300;
var nativeImport = new Function("specifier", "return import(specifier)");
var RenderClient = class {
  constructor(onResult) {
    this.onResult = onResult;
  }
  worker;
  busy = false;
  pending;
  nextId = 1;
  /** Latest wins: a request made while the worker is busy replaces any queued one. */
  request(request) {
    this.pending = request;
    this.pump();
  }
  pump() {
    if (this.busy || !this.pending) {
      return;
    }
    const request = { ...this.pending, id: this.nextId++ };
    this.pending = void 0;
    this.busy = true;
    this.ensureWorker().postMessage(request);
  }
  ensureWorker() {
    if (this.worker) {
      return this.worker;
    }
    const worker = new Worker(path2.join(DIST_DIR, "render-worker.js"));
    worker.unref();
    worker.on("message", (response) => {
      this.busy = false;
      this.onResult(response);
      this.pump();
    });
    worker.on("exit", () => {
      if (this.worker === worker) {
        this.worker = void 0;
        this.busy = false;
      }
    });
    this.worker = worker;
    return worker;
  }
  dispose() {
    this.pending = void 0;
    void this.worker?.terminate();
    this.worker = void 0;
  }
};
function pistatusline(pi) {
  const baseDir = path2.join(getAgentDir(), "pistatusline");
  const configPath = path2.join(baseDir, "settings.json");
  const statePath = path2.join(baseDir, "state.json");
  let state = readState(statePath);
  let ctx;
  let lines = [];
  let footerWidth = 0;
  let footerInstalled = false;
  let requestFooterRender;
  let debounceTimer;
  let refreshTimer;
  const client = new RenderClient((response) => {
    if (response.needsUsage) {
      usage.start();
    }
    lines = response.lines;
    requestFooterRender?.();
  });
  const usage = new PlanUsage([
    anthropicUsageSource(async () => {
      if (readStoredCredential("anthropic")?.type !== "oauth") {
        return null;
      }
      return await ctx?.modelRegistry.getApiKeyForProvider("anthropic") ?? null;
    }),
    // Resolves the key pi stores for the provider (/login or OPENCODE_API_KEY).
    opencodeGoUsageSource(async () => await ctx?.modelRegistry.getApiKeyForProvider("opencode-go") ?? null)
  ], () => {
    scheduleRender(0);
  });
  function renderNow() {
    if (!ctx || !footerInstalled || footerWidth <= 0) {
      return;
    }
    try {
      const sessionManager = ctx.sessionManager;
      const allEntries = sessionManager.getEntries();
      const branchEntries = sessionManager.getBranch();
      const startedAt = sessionManager.getHeader()?.timestamp ?? allEntries[0]?.timestamp;
      const startMs = startedAt ? Date.parse(startedAt) : Number.NaN;
      client.request({
        configPath,
        width: footerWidth,
        status: buildStatusJson({
          cwd: ctx.cwd,
          sessionId: sessionManager.getSessionId(),
          piVersion: VERSION,
          ...ctx.model ? { model: { id: ctx.model.id, name: ctx.model.name } } : {},
          thinkingLevel: pi.getThinkingLevel(),
          ...ctx.getContextUsage() ? { context: ctx.getContextUsage() } : {},
          allEntries,
          branchEntries,
          sessionStartMs: Number.isFinite(startMs) ? startMs : null,
          nowMs: Date.now()
        }),
        records: toTranscriptRecords(branchEntries),
        sessionName: sessionManager.getSessionName() ?? null,
        usage: usage.get(ctx.model?.provider)
      });
    } catch {
    }
  }
  function scheduleRender(delayMs = RENDER_DEBOUNCE_MS) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(renderNow, delayMs);
    debounceTimer.unref?.();
  }
  function applyState(context) {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = void 0;
    }
    if (!state.enabled) {
      if (footerInstalled) {
        context.ui.setFooter(void 0);
        footerInstalled = false;
      }
      return;
    }
    if (!footerInstalled) {
      context.ui.setFooter((tui) => {
        requestFooterRender = () => {
          tui.requestRender();
        };
        return {
          render(width) {
            if (width !== footerWidth) {
              footerWidth = width;
              scheduleRender(0);
            }
            return lines.map((line) => truncateStyledText(line, width));
          },
          invalidate() {
          },
          dispose() {
            requestFooterRender = void 0;
          }
        };
      });
      footerInstalled = true;
    }
    if (state.refreshInterval) {
      refreshTimer = setInterval(() => {
        scheduleRender(0);
      }, state.refreshInterval * 1e3);
      refreshTimer.unref?.();
    }
    scheduleRender(0);
  }
  pi.on("session_start", (_event, context) => {
    ctx = context;
    if (context.mode !== "tui") {
      return;
    }
    footerInstalled = false;
    state = readState(statePath);
    applyState(context);
  });
  const onAny = pi.on.bind(pi);
  for (const event of [
    "message_end",
    "turn_end",
    "agent_end",
    "model_select",
    "thinking_level_select",
    "session_compact",
    "session_tree",
    "session_info_changed",
    "tool_result",
    "user_bash"
  ]) {
    onAny(event, (_event, context) => {
      ctx = context;
      scheduleRender();
    });
  }
  pi.on("session_shutdown", () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    usage.dispose();
    client.dispose();
    ctx = void 0;
  });
  pi.registerCommand("pistatusline", {
    description: "Configure the status line (ccstatusline editor)",
    handler: async (_args, context) => {
      if (context.mode !== "tui") {
        context.ui.notify("/pistatusline needs the interactive terminal UI", "warning");
        return;
      }
      const host = {
        isEnabled: () => state.enabled,
        setEnabled: (enabled) => {
          state = { ...state, enabled };
          writeState(statePath, state);
          return Promise.resolve();
        },
        getRefreshInterval: () => state.refreshInterval,
        setRefreshInterval: (seconds) => {
          state = { ...state, refreshInterval: seconds };
          writeState(statePath, state);
          return Promise.resolve();
        }
      };
      let failure;
      await context.ui.custom((tui, _theme, _keybindings, done) => {
        setImmediate(() => {
          void (async () => {
            tui.stop();
            try {
              const editor = await nativeImport(pathToFileURL(path2.join(DIST_DIR, "tui.js")).href);
              await editor.runEditor(host, configPath);
            } catch (error) {
              failure = error;
            } finally {
              tui.start();
              tui.requestRender(true);
              done();
            }
          })();
        });
        return { render: () => [], invalidate: () => void 0 };
      });
      if (failure) {
        context.ui.notify(`pistatusline editor failed: ${failure instanceof Error ? failure.message : String(failure)}`, "error");
      }
      applyState(context);
    }
  });
}
export {
  pistatusline as default
};
