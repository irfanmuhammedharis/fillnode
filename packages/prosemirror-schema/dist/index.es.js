import { undo, redo, history } from 'prosemirror-history';
import { Plugin, TextSelection, Selection, NodeSelection, PluginKey } from 'prosemirror-state';
export { EditorState, Selection } from 'prosemirror-state';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { MenuItem, menuBar } from 'prosemirror-menu';
import { goToNextCell, CellSelection, TableMap, deleteTable, deleteRow, deleteColumn, addRowAfter, addColumnAfter, addColumnBefore, addRowBefore, tableNodes, tableEditing } from 'prosemirror-tables';
import { DecorationSet, Decoration } from 'prosemirror-view';
export { EditorView } from 'prosemirror-view';
import { InputRule, inputRules, wrappingInputRule, textblockTypeInputRule, undoInputRule } from 'prosemirror-inputrules';
import { Slice, Fragment, Schema } from 'prosemirror-model';
import { hasParentNodeOfType, safeInsert } from 'prosemirror-utils';
import * as baseListCommand from 'prosemirror-schema-list';
import { wrapInList, orderedList, bulletList, listItem } from 'prosemirror-schema-list';
import LinkifyIt from 'linkify-it';
import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectNodeBackward, toggleMark, exitCode, joinUp, joinDown, selectParentNode, newlineInCode, createParagraphNear as createParagraphNear$1, liftEmptyBlock, splitBlock, setBlockType } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, schema } from 'prosemirror-markdown';
import MarkdownItSup from 'markdown-it-sup';

var Placeholder = (placeholderText = '') => {
  return new Plugin({
    props: {
      decorations: state => {
        const decorations = [];
        const decorate = (node, pos) => {
          if (state.doc.content.size === 2) {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, {
              class: 'empty-node',
              'data-placeholder': placeholderText
            }));
          }
        };
        state.doc.descendants(decorate);
        return DecorationSet.create(state.doc, decorations);
      }
    }
  });
};

/**
 * Determine if a mark (with specific attribute values) exists anywhere in the selection.
 */
const markActive = (state, mark) => {
  const {
    from,
    to,
    empty
  } = state.selection;
  // When the selection is empty, only the active marks apply.
  if (empty) {
    return !!mark.isInSet(state.tr.storedMarks || state.selection.$from.marks());
  }
  // For a non-collapsed selection, the marks on the nodes matter.
  let found = false;
  state.doc.nodesBetween(from, to, node => {
    found = found || mark.isInSet(node.marks);
  });
  return found;
};
const hasCode = (state, pos) => {
  const {
    code
  } = state.schema.marks;
  const node = pos >= 0 && state.doc.nodeAt(pos);
  if (node) {
    return !!node.marks.filter(mark => mark.type === code).length;
  }
  return false;
};
const hasUnsupportedMarkForBlockInputRule = (state, start, end) => {
  const {
    doc,
    schema: {
      marks
    }
  } = state;
  let unsupportedMarksPresent = false;
  const isUnsupportedMark = node => node.type === marks.code || node.type === marks.link;
  doc.nodesBetween(start, end, node => {
    unsupportedMarksPresent = unsupportedMarksPresent || node.marks.filter(isUnsupportedMark).length > 0;
  });
  return unsupportedMarksPresent;
};
const hasUnsupportedMarkForInputRule = (state, start, end) => {
  const {
    doc,
    schema: {
      marks
    }
  } = state;
  let unsupportedMarksPresent = false;
  const isCodemark = mark => mark.type === marks.code;
  doc.nodesBetween(start, end, node => {
    unsupportedMarksPresent = unsupportedMarksPresent || node.marks.filter(isCodemark).length > 0;
  });
  return unsupportedMarksPresent;
};
function defaultInputRuleHandler(inputRule, isBlockNodeRule = false) {
  const originalHandler = inputRule.handler;
  inputRule.handler = (state, match, start, end) => {
    // Skip any input rule inside code
    // https://product-fabric.atlassian.net/wiki/spaces/E/pages/37945345/Editor+content+feature+rules#Editorcontent/featurerules-Rawtextblocks
    const unsupportedMarks = isBlockNodeRule ? hasUnsupportedMarkForBlockInputRule(state, start, end) : hasUnsupportedMarkForInputRule(state, start, end);
    if (state.selection.$from.parent.type.spec.code || unsupportedMarks) {
      return;
    }
    return originalHandler(state, match, start, end);
  };
  return inputRule;
}
const createInputRule$1 = (match, handler, isBlockNodeRule = false) => defaultInputRuleHandler(new InputRule(match, handler), isBlockNodeRule);

// ProseMirror uses the Unicode Character 'OBJECT REPLACEMENT CHARACTER' (U+FFFC) as text representation for
// leaf nodes, i.e. nodes that don't have any content or text property (e.g. hardBreak, emoji, mention, rule)
// It was introduced because of https://github.com/ProseMirror/prosemirror/issues/262
// This can be used in an input rule regex to be able to include or exclude such nodes.
const leafNodeReplacementCharacter = '\ufffc';

/**
 * Returns false if node contains only empty inline nodes and hardBreaks.
 */
function hasVisibleContent(node) {
  const isInlineNodeHasVisibleContent = inlineNode => {
    return inlineNode.isText ? !!inlineNode.textContent.trim() : inlineNode.type.name !== 'hardBreak';
  };
  if (node.isInline) {
    return isInlineNodeHasVisibleContent(node);
  } else if (node.isBlock && (node.isLeaf || node.isAtom)) {
    return true;
  } else if (!node.childCount) {
    return false;
  }
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    if (hasVisibleContent(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if node is an empty paragraph.
 */
function isEmptyParagraph$1(node) {
  return !node || node.type.name === 'paragraph' && !node.textContent && !node.childCount;
}

/**
 * Checks if a node has any content. Ignores node that only contain empty block nodes.
 */
function isNodeEmpty(node) {
  if (node && node.textContent) {
    return false;
  }
  if (!node || !node.childCount || node.childCount === 1 && isEmptyParagraph$1(node.firstChild)) {
    return true;
  }
  const block = [];
  const nonBlock = [];
  node.forEach(child => {
    child.isInline ? nonBlock.push(child) : block.push(child);
  });
  return !nonBlock.length && !block.filter(childNode => !!childNode.childCount && !(childNode.childCount === 1 && isEmptyParagraph$1(childNode.firstChild)) || childNode.isAtom).length;
}
const compose = (...functions) => args => functions.reduceRight((arg, fn) => fn(arg), args);

/**
 * A helper to get the underlying array of a fragment.
 */
function getFragmentBackingArray(fragment) {
  return fragment.content;
}
function mapFragment(content, callback, parent) {
  const children = [];
  for (let i = 0, size = content.childCount; i < size; i++) {
    const node = content.child(i);
    const transformed = node.isLeaf ? callback(node, parent, i) : callback(node.copy(mapFragment(node.content, callback, node)), parent, i);
    if (transformed) {
      if (transformed) {
        children.push(...getFragmentBackingArray(transformed));
      } else if (Array.isArray(transformed)) {
        children.push(...transformed);
      } else {
        children.push(transformed);
      }
    }
  }
  return Fragment.fromArray(children);
}
function mapSlice(slice, callback) {
  const fragment = mapFragment(slice.content, callback);
  return new Slice(fragment, slice.openStart, slice.openEnd);
}
function atTheEndOfDoc(state) {
  const {
    selection,
    doc
  } = state;
  return doc.nodeSize - selection.$to.pos - 2 === selection.$to.depth;
}
function canMoveDown(state) {
  const {
    selection
  } = state;
  if (selection instanceof TextSelection) {
    if (!selection.empty) {
      return true;
    }
  }
  return !atTheEndOfDoc(state);
}
function atTheBeginningOfDoc(state) {
  const {
    selection
  } = state;
  return selection.$from.pos === selection.$from.depth;
}
function canMoveUp(state) {
  const {
    selection
  } = state;
  if (selection instanceof TextSelection) {
    if (!selection.empty) {
      return true;
    }
  }
  return !atTheBeginningOfDoc(state);
}

const maxIndentation = 3;
function createInputRule(regexp, nodeType) {
  return wrappingInputRule(regexp, nodeType, {}, (_, node) => node.type === nodeType);
}
const insertList = (state, listType, listTypeName, start, end) => {
  // To ensure that match is done after HardBreak.
  const {
    hardBreak
  } = state.schema.nodes;
  if (state.doc.resolve(start).nodeAfter.type !== hardBreak) {
    return null;
  }

  // To ensure no nesting is done.
  if (state.doc.resolve(start).depth > 1) {
    return null;
  }

  // Split at the start of autoformatting and delete formatting characters.
  let tr = state.tr.delete(start, end).split(start);

  // If node has more content split at the end of autoformatting.
  let currentNode = tr.doc.nodeAt(start + 1);
  tr.doc.nodesBetween(start, start + currentNode.nodeSize, (node, pos) => {
    if (node.type === hardBreak) {
      tr = tr.split(pos + 1).delete(pos, pos + 1);
    }
  });

  // Wrap content in list node
  const {
    list_item
  } = state.schema.nodes;
  const position = tr.doc.resolve(start + 2);
  let range = position.blockRange(position);
  tr = tr.wrap(range, [{
    type: listType
  }, {
    type: list_item
  }]);
  return tr;
};

/**
 * Create input rules for bullet list node
 *
 * @param {Schema} schema
 * @returns {InputRule[]}
 */
function getBulletListInputRules(schema) {
  const asteriskRule = createInputRule(/^\s*([\*\-]) $/, schema.nodes['bullet_list']);
  const leafNodeAsteriskRule = createInputRule$1(new RegExp(`${leafNodeReplacementCharacter}\\s*([\\*\\-]) $`), (state, _match, start, end) => {
    return insertList(state, schema.nodes['bullet_list'], 'bullet', start, end);
  }, true);
  return [asteriskRule, leafNodeAsteriskRule];
}

/**
 * Create input rules for strong mark
 *
 * @param {Schema} schema
 * @returns {InputRule[]}
 */
function getOrderedListInputRules(schema) {
  // NOTE: There is a built in input rule for ordered lists in ProseMirror. However, that
  // input rule will allow for a list to start at any given number, which isn't allowed in
  // markdown (where a ordered list will always start on 1). This is a slightly modified
  // version of that input rule.
  const numberOneRule = createInputRule(/^(1)[\.\)] $/, schema.nodes['ordered_list']);
  const leafNodeNumberOneRule = createInputRule$1(new RegExp(`${leafNodeReplacementCharacter}(1)[\\.\\)] $`), (state, _match, start, end) => {
    return insertList(state, schema.nodes['ordered_list'], 'numbered', start, end);
  }, true);
  return [numberOneRule, leafNodeNumberOneRule];
}
function listInputRules(schema) {
  const rules = [];
  if (schema.nodes['bullet_list']) {
    rules.push(...getBulletListInputRules(schema));
  }
  if (schema.nodes['ordered_list']) {
    rules.push(...getOrderedListInputRules(schema));
  }
  if (rules.length !== 0) {
    return inputRules({
      rules
    });
  }
  return;
}
const isInsideListItem = state => {
  const {
    $from
  } = state.selection;
  const {
    list_item,
    paragraph
  } = state.schema.nodes;
  return hasParentNodeOfType(list_item)(state.selection) && $from.parent.type === paragraph;
};

// Returns the number of nested lists that are ancestors of the given selection
const numberNestedLists = (resolvedPos, nodes) => {
  const {
    bullet_list,
    ordered_list
  } = nodes;
  let count = 0;
  for (let i = resolvedPos.depth - 1; i > 0; i--) {
    const node = resolvedPos.node(i);
    if (node.type === bullet_list || node.type === ordered_list) {
      count += 1;
    }
  }
  return count;
};

/**
 * Merge closest bullet list blocks into one
 *
 * @param {NodeType} listItem
 * @param {NodeRange} range
 * @returns
 */
function mergeLists(listItem, range) {
  return command => {
    return (state, dispatch) => command(state, tr => {
      const $start = state.doc.resolve(range.start);
      const $end = state.doc.resolve(range.end);
      const $join = tr.doc.resolve(tr.mapping.map(range.end - 1));
      if ($join.nodeBefore && $join.nodeAfter && $join.nodeBefore.type === $join.nodeAfter.type) {
        if ($end.nodeAfter && $end.nodeAfter.type === listItem && $end.parent.type === $start.parent.type) {
          tr.join($join.pos);
        }
      }
      if (dispatch) {
        dispatch(tr.scrollIntoView());
      }
    });
  };
}
function outdentList() {
  return function (state, dispatch) {
    const {
      list_item
    } = state.schema.nodes;
    const {
      $from,
      $to
    } = state.selection;
    if (isInsideListItem(state)) {
      let range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild.type === list_item);
      if (!range) {
        return false;
      }
      return compose(mergeLists(list_item, range),
      // 2. Check if I need to merge nearest list
      baseListCommand.liftListItem // 1. First lift list item
      )(list_item)(state, dispatch);
    }
    return false;
  };
}
function splitListItem(itemType) {
  return function (state, dispatch) {
    const ref = state.selection;
    const $from = ref.$from;
    const $to = ref.$to;
    const node = ref.node;
    if (node && node.isBlock || $from.depth < 2 || !$from.sameParent($to)) {
      return false;
    }
    const grandParent = $from.node(-1);
    if (grandParent.type !== itemType) {
      return false;
    }
    if (grandParent.content.content.length <= 1 && $from.parent.content.size === 0 && !(grandParent.content.size === 0)) {
      // In an empty block. If this is a nested list, the wrapping
      // list item should be split. Otherwise, bail out and let next
      // command handle lifting.
      if ($from.depth === 2 || $from.node(-3).type !== itemType || $from.index(-2) !== $from.node(-2).childCount - 1) {
        return false;
      }
      if (dispatch) {
        let wrap = Fragment.empty;
        const keepItem = $from.index(-1) > 0;
        // Build a fragment containing empty versions of the structure
        // from the outer list item to the parent node of the cursor
        for (let d = $from.depth - (keepItem ? 1 : 2); d >= $from.depth - 3; d--) {
          wrap = Fragment.from($from.node(d).copy(wrap));
        }
        // Add a second list item with an empty default start node
        wrap = wrap.append(Fragment.from(itemType.createAndFill()));
        const tr$1 = state.tr.replace($from.before(keepItem ? undefined : -1), $from.after(-3), new Slice(wrap, keepItem ? 3 : 2, 2));
        tr$1.setSelection(state.selection.constructor.near(tr$1.doc.resolve($from.pos + (keepItem ? 3 : 2))));
        dispatch(tr$1.scrollIntoView());
      }
      return true;
    }
    const nextType = $to.pos === $from.end() ? grandParent.contentMatchAt(0).defaultType : undefined;
    const tr = state.tr.delete($from.pos, $to.pos);
    const types = nextType && [undefined, {
      type: nextType
    }];
    if (dispatch) {
      dispatch(tr.split($from.pos, 2, types).scrollIntoView());
    }
    return true;
  };
}
const enterKeyOnListCommand = (state, dispatch) => {
  const {
    selection
  } = state;
  if (selection.empty) {
    const {
      $from
    } = selection;
    const {
      list_item
    } = state.schema.nodes;
    const node = $from.node($from.depth);
    const wrapper = $from.node($from.depth - 1);
    if (wrapper && wrapper.type === list_item) {
      /** Check if the wrapper has any visible content */
      const wrapperHasContent = hasVisibleContent(wrapper);
      if (isNodeEmpty(node) && !wrapperHasContent) {
        return outdentList()(state, dispatch);
      } else {
        return splitListItem(list_item)(state, dispatch);
      }
    }
  }
  return false;
};

/**
 * Check if we can sink the list.
 *
 * @param {number} initialIndentationLevel
 * @param {EditorState} state
 * @returns {boolean} - true if we can sink the list
 *                    - false if we reach the max indentation level
 */
function canSink(initialIndentationLevel, state) {
  /*
  - Keep going forward in document until indentation of the node is < than the initial
  - If indentation is EVER > max indentation, return true and don't sink the list
  */
  let currentIndentationLevel;
  let currentPos = state.tr.selection.$to.pos;
  do {
    const resolvedPos = state.doc.resolve(currentPos);
    currentIndentationLevel = numberNestedLists(resolvedPos, state.schema.nodes);
    if (currentIndentationLevel > maxIndentation) {
      // Cancel sink list.
      // If current indentation less than the initial, it won't be
      // larger than the max, and the loop will terminate at end of this iteration
      return false;
    }
    currentPos++;
  } while (currentIndentationLevel >= initialIndentationLevel);
  return true;
}
function indentList() {
  return function (state, dispatch) {
    const {
      list_item
    } = state.schema.nodes;
    if (isInsideListItem(state)) {
      // Record initial list indentation
      const initialIndentationLevel = numberNestedLists(state.selection.$from, state.schema.nodes);
      if (canSink(initialIndentationLevel, state)) {
        baseListCommand.sinkListItem(list_item)(state, dispatch);
      }
      return true;
    }
    return false;
  };
}

// This is a copy of the linkify-it regex, passing `undefined` for the schema
// will use the default regex.
const linkify = new LinkifyIt(undefined, {
  fuzzyLink: false
});
linkify.add('sourcetree:', 'http:');
const tlds = 'app|biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф'.split('|');
const tlds2Char = 'a[cdefgilmnoqrtuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrtuvwxyz]|n[acefgilopruz]|om|p[aefghkmnrtw]|qa|r[eosuw]|s[abcdegijklmnrtuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]';
tlds.push(tlds2Char);
linkify.tlds(tlds, false);
function createLinkInputRule(regexp) {
  // Plain typed text (eg, typing 'www.google.com') should convert to a hyperlink
  return createInputRule$1(regexp, (state, match, start, end) => {
    const {
      schema
    } = state;
    if (state.doc.rangeHasMark(start, end, schema.marks.link)) {
      return null;
    }
    const [link] = match;
    const url = normalizeUrl(link.url);
    const markType = schema.mark('link', {
      href: url
    });
    return state.tr.addMark(start - (link.input.length - link.lastIndex), end - (link.input.length - link.lastIndex), markType).insertText(' ');
  });
}
class LinkMatcher {
  exec(str) {
    if (str.endsWith(' ')) {
      const chunks = str.slice(0, str.length - 1).split(' ');
      const lastChunk = chunks[chunks.length - 1];
      const links = linkify.match(lastChunk);
      if (links && links.length > 0) {
        const lastLink = links[links.length - 1];
        lastLink.input = lastChunk;
        lastLink.length = lastLink.lastIndex - lastLink.index + 1;
        return [lastLink];
      }
    }
    return null;
  }
}
const whitelistedURLPatterns = [/^https?:\/\//im, /^ftps?:\/\//im, /^\//im, /^mailto:/im, /^skype:/im, /^callto:/im, /^facetime:/im, /^git:/im, /^irc6?:/im, /^news:/im, /^nntp:/im, /^feed:/im, /^cvs:/im, /^svn:/im, /^mvn:/im, /^ssh:/im, /^scp:\/\//im, /^sftp:\/\//im, /^itms:/im, /^notes:/im, /^hipchat:\/\//im, /^sourcetree:/im, /^urn:/im, /^tel:/im, /^xmpp:/im, /^telnet:/im, /^vnc:/im, /^rdp:/im, /^whatsapp:/im, /^slack:/im, /^sips?:/im, /^magnet:/im];
const isSafeUrl = url => {
  return whitelistedURLPatterns.some(p => p.test(url.trim()) === true);
};
function getLinkMatch(str) {
  const match = str && linkify.match(str);
  return match && match[0];
}

/**
 * Adds protocol to url if needed.
 */
function normalizeUrl(url) {
  if (!url) {
    return '';
  }
  if (isSafeUrl(url)) {
    return url;
  }
  const match = getLinkMatch(url);
  return match && match.url || '';
}
function linksInputRules(schema) {
  if (!schema.marks.link) {
    return;
  }
  const urlWithASpaceRule = createLinkInputRule(new LinkMatcher());

  // [something](link) should convert to a hyperlink
  const markdownLinkRule = createInputRule$1(/(^|[^!])\[(.*?)\]\((\S+)\)$/, (state, match, start, end) => {
    const {
      schema
    } = state;
    const [, prefix, linkText, linkUrl] = match;
    const url = normalizeUrl(linkUrl);
    const markType = schema.mark('link', {
      href: url
    });
    return state.tr.replaceWith(start + prefix.length, end, schema.text(linkText, [markType]));
  });
  return inputRules({
    rules: [urlWithASpaceRule, markdownLinkRule]
  });
}

const applyMarkOnRange = (from, to, removeMark, mark, tr) => {
  // const { schema } = tr.doc.type;
  // const { code } = schema.marks;
  // if (mark.type === code) {
  // // When turning to code we need to flat some special characters
  // import { transformSmartCharsMentionsAndEmojis } from '../plugins/text-formatting/commands/transform-to-code';
  //   transformSmartCharsMentionsAndEmojis(from, to, tr);
  // }

  tr.doc.nodesBetween(tr.mapping.map(from), tr.mapping.map(to), (node, pos) => {
    if (!node.isText) {
      return true;
    }

    // This is an issue when the user selects some text.
    // We need to check if the current node position is less than the range selection from.
    // If it’s true, that means we should apply the mark using the range selection,
    // not the current node position.
    const nodeBetweenFrom = Math.max(pos, tr.mapping.map(from));
    const nodeBetweenTo = Math.min(pos + node.nodeSize, tr.mapping.map(to));
    {
      tr.addMark(nodeBetweenFrom, nodeBetweenTo, mark);
    }
    return true;
  });
  return tr;
};
const moveRight = () => {
  return (state, dispatch) => {
    const {
      code
    } = state.schema.marks;
    const {
      empty,
      $cursor
    } = state.selection;
    if (!empty || !$cursor) {
      return false;
    }
    const {
      storedMarks
    } = state.tr;
    if (code) {
      const insideCode = markActive(state, code.create());
      const currentPosHasCode = state.doc.rangeHasMark($cursor.pos, $cursor.pos, code);
      const nextPosHasCode = state.doc.rangeHasMark($cursor.pos, $cursor.pos + 1, code);
      const exitingCode = !currentPosHasCode && !nextPosHasCode && (!storedMarks || !!storedMarks.length);
      const enteringCode = !currentPosHasCode && nextPosHasCode && (!storedMarks || !storedMarks.length);

      // entering code mark (from the left edge): don't move the cursor, just add the mark
      if (!insideCode && enteringCode) {
        if (dispatch) {
          dispatch(state.tr.addStoredMark(code.create()));
        }
        return true;
      }

      // exiting code mark: don't move the cursor, just remove the mark
      if (insideCode && exitingCode) {
        if (dispatch) {
          dispatch(state.tr.removeStoredMark(code));
        }
        return true;
      }
    }
    return false;
  };
};
const moveLeft = () => {
  return (state, dispatch) => {
    const {
      code
    } = state.schema.marks;
    const {
      empty,
      $cursor
    } = state.selection;
    if (!empty || !$cursor) {
      return false;
    }
    const {
      storedMarks
    } = state.tr;
    if (code) {
      const insideCode = code && markActive(state, code.create());
      const currentPosHasCode = hasCode(state, $cursor.pos);
      const nextPosHasCode = hasCode(state, $cursor.pos - 1);
      const nextNextPosHasCode = hasCode(state, $cursor.pos - 2);
      const exitingCode = currentPosHasCode && !nextPosHasCode && Array.isArray(storedMarks);
      const atLeftEdge = nextPosHasCode && !nextNextPosHasCode && (storedMarks === null || Array.isArray(storedMarks) && !!storedMarks.length);
      const atRightEdge = (exitingCode && Array.isArray(storedMarks) && !storedMarks.length || !exitingCode && storedMarks === null) && !nextPosHasCode && nextNextPosHasCode;
      const enteringCode = !currentPosHasCode && nextPosHasCode && Array.isArray(storedMarks) && !storedMarks.length;

      // at the right edge: remove code mark and move the cursor to the left
      if (!insideCode && atRightEdge) {
        const tr = state.tr.setSelection(Selection.near(state.doc.resolve($cursor.pos - 1)));
        if (dispatch) {
          dispatch(tr.removeStoredMark(code));
        }
        return true;
      }

      // entering code mark (from right edge): don't move the cursor, just add the mark
      if (!insideCode && enteringCode) {
        if (dispatch) {
          dispatch(state.tr.addStoredMark(code.create()));
        }
        return true;
      }

      // at the left edge: add code mark and move the cursor to the left
      if (insideCode && atLeftEdge) {
        const tr = state.tr.setSelection(Selection.near(state.doc.resolve($cursor.pos - 1)));
        if (dispatch) {
          dispatch(tr.addStoredMark(code.create()));
        }
        return true;
      }

      // exiting code mark (or at the beginning of the line): don't move the cursor, just remove the mark
      const isFirstChild = $cursor.index($cursor.depth - 1) === 0;
      if (insideCode && (exitingCode || !$cursor.nodeBefore && isFirstChild)) {
        if (dispatch) {
          dispatch(state.tr.removeStoredMark(code));
        }
        return true;
      }
    }
    return false;
  };
};
const insertBlock = (state, nodeType, nodeName, start, end, attrs) => {
  // To ensure that match is done after HardBreak.
  const {
    hard_break: hardBreak,
    code_block: codeBlock,
    list_item: listItem
  } = state.schema.nodes;
  const $pos = state.doc.resolve(start);
  if ($pos.nodeAfter.type !== hardBreak) {
    return null;
  }

  // To ensure no nesting is done. (unless we're inserting a codeBlock inside lists)
  if ($pos.depth > 1 && !(nodeType === codeBlock && hasParentNodeOfType(listItem)(state.selection))) {
    return null;
  }

  // Split at the start of autoformatting and delete formatting characters.
  let tr = state.tr.delete(start, end).split(start);
  let currentNode = tr.doc.nodeAt(start + 1);

  // If node has more content split at the end of autoformatting.
  let nodeHasMoreContent = false;
  tr.doc.nodesBetween(start, start + currentNode.nodeSize, (node, pos) => {
    if (!nodeHasMoreContent && node.type === hardBreak) {
      nodeHasMoreContent = true;
      tr = tr.split(pos + 1).delete(pos, pos + 1);
    }
  });
  if (nodeHasMoreContent) {
    currentNode = tr.doc.nodeAt(start + 1);
  }

  // Create new node and fill with content of current node.
  const {
    blockquote,
    paragraph
  } = state.schema.nodes;
  let content;
  let depth;
  if (nodeType === blockquote) {
    depth = 3;
    content = [paragraph.create({}, currentNode.content)];
  } else {
    depth = 2;
    content = currentNode.content;
  }
  const newNode = nodeType.create(attrs, content);

  // Add new node.
  tr = tr.setSelection(new NodeSelection(tr.doc.resolve(start + 1))).replaceSelectionWith(newNode).setSelection(new TextSelection(tr.doc.resolve(start + depth)));
  return tr;
};
function transformToCodeBlockAction(state, attrs) {
  if (!state.selection.empty) {
    // Don't do anything, if there is something selected
    return state.tr;
  }
  const codeBlock = state.schema.nodes.code_block;
  const startOfCodeBlockText = state.selection.$from;
  const parentPos = startOfCodeBlockText.before();
  const end = startOfCodeBlockText.end();
  const codeBlockSlice = mapSlice(state.doc.slice(startOfCodeBlockText.pos, end), node => {
    if (node.type === state.schema.nodes.hard_break) {
      return state.schema.text('\n');
    }
    if (node.isText) {
      return node.mark([]);
    } else if (node.isInline) {
      return node.attrs.text ? state.schema.text(node.attrs.text) : null;
    } else {
      return node.content.childCount ? node.content : null;
    }
  });
  const tr = state.tr.replaceRange(startOfCodeBlockText.pos, end, codeBlockSlice);
  // If our offset isnt at 3 (backticks) at the start of line, cater for content.
  if (startOfCodeBlockText.parentOffset >= 3) {
    return tr.split(startOfCodeBlockText.pos, undefined, [{
      type: codeBlock,
      attrs
    }]);
  }
  // TODO: Check parent node for valid code block marks, ATM It's not necessary because code block doesn't have any valid mark.
  const codeBlockMarks = [];
  return tr.setNodeMarkup(parentPos, codeBlock, attrs, codeBlockMarks);
}
function isConvertableToCodeBlock(state) {
  // Before a document is loaded, there is no selection.
  if (!state.selection) {
    return false;
  }
  const {
    $from
  } = state.selection;
  const node = $from.parent;
  if (!node.isTextblock || node.type === state.schema.nodes.code_block) {
    return false;
  }
  const parentDepth = $from.depth - 1;
  const parentNode = $from.node(parentDepth);
  const index = $from.index(parentDepth);
  return parentNode.canReplaceWith(index, index + 1, state.schema.nodes.code_block);
}
const cleanUpAtTheStartOfDocument = (state, dispatch) => {
  const {
    $cursor
  } = state.selection;
  if ($cursor && !$cursor.nodeBefore && !$cursor.nodeAfter && $cursor.pos === 1) {
    const {
      tr,
      schema
    } = state;
    const {
      paragraph
    } = schema.nodes;
    const {
      parent
    } = $cursor;

    /**
     * Use cases:
     * 1. Change `heading` to `paragraph`
     * 2. Remove block marks
     *
     * NOTE: We already know it's an empty doc so it's safe to use 0
     */
    tr.setNodeMarkup(0, paragraph, parent.attrs, []);
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  }
  return false;
};
function canCreateParagraphNear(state) {
  const {
    selection: {
      $from
    }
  } = state;
  const node = $from.node($from.depth);
  const insideCodeBlock = !!node && node.type === state.schema.nodes.code_block;
  const isNodeSelection = state.selection instanceof NodeSelection;
  return $from.depth > 1 || isNodeSelection || insideCodeBlock;
}
const createNewParagraphBelow = (state, dispatch) => {
  const append = true;
  if (!canMoveDown(state) && canCreateParagraphNear(state)) {
    createParagraphNear(append)(state, dispatch);
    return true;
  }
  return false;
};
const createNewParagraphAbove = (state, dispatch) => {
  const append = false;
  if (!canMoveUp(state) && canCreateParagraphNear(state)) {
    createParagraphNear(append)(state, dispatch);
    return true;
  }
  return false;
};
function topLevelNodeIsEmptyTextBlock(state) {
  const topLevelNode = state.selection.$from.node(1);
  return topLevelNode.isTextblock && topLevelNode.type !== state.schema.nodes.code_block && topLevelNode.nodeSize === 2;
}
function getInsertPosFromTextBlock(state, append) {
  const {
    $from,
    $to
  } = state.selection;
  let pos;
  if (!append) {
    pos = $from.start(0);
  } else {
    pos = $to.end(0);
  }
  return pos;
}
function getInsertPosFromNonTextBlock(state, append) {
  const {
    $from,
    $to
  } = state.selection;
  let pos;
  if (!append) {
    // The start position is different with text block because it starts from 0
    pos = $from.start($from.depth);
    // The depth is different with text block because it starts from 0
    pos = $from.depth > 0 ? pos - 1 : pos;
  } else {
    pos = $to.end($to.depth);
    pos = $to.depth > 0 ? pos + 1 : pos;
  }
  return pos;
}
function createParagraphNear(append = true) {
  return function (state, dispatch) {
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) {
      return false;
    }
    let insertPos;
    if (state.selection instanceof TextSelection) {
      if (topLevelNodeIsEmptyTextBlock(state)) {
        return false;
      }
      insertPos = getInsertPosFromTextBlock(state, append);
    } else {
      insertPos = getInsertPosFromNonTextBlock(state, append);
    }
    const tr = state.tr.insert(insertPos, paragraph.createAndFill());
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

const MAX_HEADING_LEVEL = 6;
function getHeadingLevel(match) {
  return {
    level: match[1].length
  };
}
function headingRule(nodeType, maxLevel) {
  return textblockTypeInputRule(new RegExp('^(#{1,' + maxLevel + '})\\s$'), nodeType, getHeadingLevel);
}
function blockQuoteRule(nodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType);
}

/**
 * Get heading rules
 *
 * @param {Schema} schema
 * @returns {}
 */
function getHeadingRules(schema) {
  // '# ' for h1, '## ' for h2 and etc
  const hashRule = defaultInputRuleHandler(headingRule(schema.nodes.heading, MAX_HEADING_LEVEL), true);
  const leftNodeReplacementHashRule = createInputRule$1(new RegExp(`${leafNodeReplacementCharacter}(#{1,6})\\s$`), (state, match, start, end) => {
    const level = match[1].length;
    return insertBlock(state, schema.nodes.heading, `heading${level}`, start, end, {
      level
    });
  }, true);
  return [hashRule, leftNodeReplacementHashRule];
}

/**
 * Get all block quote input rules
 *
 * @param {Schema} schema
 * @returns {}
 */
function getBlockQuoteRules(schema) {
  // '> ' for blockquote
  const greatherThanRule = defaultInputRuleHandler(blockQuoteRule(schema.nodes.blockquote), true);
  const leftNodeReplacementGreatherRule = createInputRule$1(new RegExp(`${leafNodeReplacementCharacter}\\s*>\\s$`), (state, _match, start, end) => {
    return insertBlock(state, schema.nodes.blockquote, 'blockquote', start, end);
  }, true);
  return [greatherThanRule, leftNodeReplacementGreatherRule];
}

/**
 * Get all code block input rules
 *
 * @param {Schema} schema
 * @returns {}
 */
function getCodeBlockRules(schema) {
  const threeTildeRule = createInputRule$1(/((^`{3,})|(\s`{3,}))(\S*)$/, (state, match, start, end) => {
    const attributes = {};
    if (match[4]) {
      attributes.language = match[4];
    }
    const newStart = match[0][0] === ' ' ? start + 1 : start;
    if (isConvertableToCodeBlock(state)) {
      const tr = transformToCodeBlockAction(state, attributes)
      // remove markdown decorator ```
      .delete(newStart, end).scrollIntoView();
      return tr;
    }
    let {
      tr
    } = state;
    tr = tr.delete(newStart, end);
    const codeBlock = state.schema.nodes.code_block.createChecked();
    return safeInsert(codeBlock)(tr);
  }, true);
  const leftNodeReplacementThreeTildeRule = createInputRule$1(new RegExp(`((${leafNodeReplacementCharacter}\`{3,})|(\\s\`{3,}))(\\S*)$`), (state, match, start, end) => {
    const attributes = {};
    if (match[4]) {
      attributes.language = match[4];
    }
    let tr = insertBlock(state, schema.nodes.code_block, 'codeblock', start, end, attributes);
    return tr;
  }, true);
  return [threeTildeRule, leftNodeReplacementThreeTildeRule];
}
function blocksInputRule(schema) {
  const rules = [];
  if (schema.nodes.heading) {
    rules.push(...getHeadingRules(schema));
  }
  if (schema.nodes.blockquote) {
    rules.push(...getBlockQuoteRules(schema));
  }
  if (schema.nodes.code_block) {
    rules.push(...getCodeBlockRules(schema));
  }
  if (rules.length !== 0) {
    return inputRules({
      rules
    });
  }
  return;
}

function createHorizontalRuleInputRule(type) {
  return createInputRule$1(/^(?:---|___|\*\*\*)\s$/,
  // Ensures rule is triggered with space after "---", "___", or "***"
  (state, match, start, end) => {
    if (!match[0]) {
      return null; // If no match found, return null
    }

    // Deletes the matched sequence including the space
    let tr = state.tr.delete(start, end);
    const hrPos = start; // Position where the horizontal rule should be inserted

    // Insert the horizontal rule at the position
    tr = safeInsert(type.create(), hrPos)(tr);

    // Insert a paragraph node after the horizontal rule
    tr = safeInsert(state.schema.nodes.paragraph.create(), tr.mapping.map(hrPos + 1))(tr);
    return tr;
  });
}
function hrInputRules(schema) {
  if (!schema.nodes.horizontal_rule) {
    // Ensures that horizontal_rule is part of the schema
    return inputRules({
      rules: []
    });
  }
  const hrRule = createHorizontalRuleInputRule(schema.nodes.horizontal_rule);
  return inputRules({
    rules: [hrRule]
  });
}

const mac = typeof navigator !== 'undefined' ? /Mac/.test(navigator.platform) : false;

// Find the table node at the given depth from $from, or -1
function findTableDepth($from, tableType) {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === tableType) return d;
  }
  return -1;
}

// Find the cell node depth between tableDepth and $from.depth
function findCellDepth($from, tableDepth, cellType, headerType) {
  for (let d = $from.depth; d > tableDepth; d--) {
    const t = $from.node(d).type;
    if (t === cellType || t === headerType) return d;
  }
  return -1;
}
function baseKeyMaps(schema) {
  let keys = {
    ...baseKeymap
  };
  function bind(key, cmd) {
    keys[key] = cmd;
  }
  bind('Mod-z', chainCommands(undoInputRule, undo));
  bind('Shift-Mod-z', redo);
  const backspaceComands = chainCommands(undoInputRule, cleanUpAtTheStartOfDocument, deleteSelection, joinBackward, selectNodeBackward);
  bind('Backspace', backspaceComands);
  bind('Mod-Backspace', backspaceComands);
  if (!mac) bind('Mod-y', redo);
  bind('Alt-ArrowUp', joinUp);
  bind('Alt-ArrowDown', joinDown);
  bind('Escape', selectParentNode);
  if (schema.nodes.table) {
    // Progressive Cmd+A: cell content → all cells → whole document
    bind('Mod-a', (state, dispatch) => {
      const {
        $from,
        from,
        to
      } = state.selection;
      const tableDepth = findTableDepth($from, schema.nodes.table);
      if (tableDepth < 0) return false;

      // Already a CellSelection → select entire document
      if (state.selection instanceof CellSelection) {
        if (dispatch) {
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
        }
        return true;
      }
      const cellDepth = findCellDepth($from, tableDepth, schema.nodes.table_cell, schema.nodes.table_header);
      if (cellDepth < 0) return false;
      const cellStart = $from.start(cellDepth);
      const cellEnd = $from.end(cellDepth);

      // Cell not fully selected → select all cell content
      if (from !== cellStart || to !== cellEnd) {
        if (dispatch) {
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, cellStart, cellEnd)));
        }
        return true;
      }

      // Cell fully selected → select all cells (CellSelection)
      if (dispatch) {
        const tableNode = $from.node(tableDepth);
        const tableStart = $from.before(tableDepth) + 1;

        // First cell: tableStart + 1 (into row) + 1 (into cell)
        const firstCellPos = tableStart + 2;

        // Last cell: walk to the last row's last cell
        let lastCellPos = tableStart;
        for (let r = 0; r < tableNode.childCount; r++) {
          lastCellPos++; // row open
          const row = tableNode.child(r);
          for (let c = 0; c < row.childCount; c++) {
            if (r === tableNode.childCount - 1 && c === row.childCount - 1) {
              lastCellPos++; // this is the last cell position (inside it)
            } else {
              lastCellPos += row.child(c).nodeSize;
            }
          }
          if (r < tableNode.childCount - 1) {
            lastCellPos++; // row close
          }
        }
        try {
          const $first = state.doc.resolve(firstCellPos);
          const $last = state.doc.resolve(lastCellPos);
          dispatch(state.tr.setSelection(CellSelection.create(state.doc, $first.before($first.depth), $last.before($last.depth))));
        } catch (_) {
          // Fallback: select whole document if cell positions are invalid
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
        }
      }
      return true;
    });

    // Backspace/Delete on CellSelection: delete selected rows, columns, or entire table
    const deleteCellSelection = (state, dispatch) => {
      if (!(state.selection instanceof CellSelection)) return false;
      const sel = state.selection;
      const {
        $anchorCell,
        $headCell
      } = sel;

      // Find the table
      let tableDepth = -1;
      for (let d = $anchorCell.depth; d >= 0; d--) {
        if ($anchorCell.node(d).type === schema.nodes.table) {
          tableDepth = d;
          break;
        }
      }
      if (tableDepth < 0) return false;
      const tableNode = $anchorCell.node(tableDepth);
      const map = TableMap.get(tableNode);

      // Count selected rows and columns
      const selectedCells = new Set();
      sel.forEachCell((_node, pos) => selectedCells.add(pos));
      const totalCells = map.width * map.height;

      // All cells selected → delete entire table
      if (selectedCells.size >= totalCells) {
        return deleteTable(state, dispatch);
      }

      // Check if entire rows are selected
      const selectedRows = new Set();
      const selectedCols = new Set();
      for (const pos of selectedCells) {
        const rect = map.findCell(pos - ($anchorCell.before(tableDepth) + 1));
        selectedRows.add(rect.top);
        selectedCols.add(rect.left);
      }
      const isFullRows = selectedCells.size === selectedRows.size * map.width;
      const isFullCols = selectedCells.size === selectedCols.size * map.height;
      if (isFullRows && selectedRows.size < map.height) {
        return deleteRow(state, dispatch);
      }
      if (isFullCols && selectedCols.size < map.width) {
        return deleteColumn(state, dispatch);
      }

      // Partial selection: just clear cell contents
      if (dispatch) {
        let tr = state.tr;
        sel.forEachCell((cell, pos) => {
          const start = pos + 1;
          const end = pos + cell.nodeSize - 1;
          if (end > start) {
            tr = tr.replaceWith(tr.mapping.map(start), tr.mapping.map(end), schema.nodes.paragraph.create());
          }
        });
        dispatch(tr);
      }
      return true;
    };
    bind('Backspace', chainCommands(deleteCellSelection, backspaceComands));
    bind('Delete', chainCommands(deleteCellSelection, deleteSelection));
    bind('Mod-Backspace', chainCommands(deleteCellSelection, backspaceComands));
  }
  bind('ArrowLeft', moveLeft());
  bind('ArrowRight', moveRight());
  bind('ArrowDown', createNewParagraphBelow);
  bind('ArrowUp', createNewParagraphAbove);
  if (schema.marks.strong) {
    bind('Mod-b', toggleMark(schema.marks.strong));
    bind('Mod-B', toggleMark(schema.marks.strong));
  }
  if (schema.marks.em) {
    bind('Mod-i', toggleMark(schema.marks.em));
    bind('Mod-I', toggleMark(schema.marks.em));
  }
  if (schema.marks.superscript) {
    bind('Shift-Mod-.', toggleMark(schema.marks.superscript));
  }
  if (schema.nodes.hard_break) {
    let br = schema.nodes.hard_break,
      cmd = chainCommands(exitCode, (state, dispatch) => {
        dispatch(state.tr.insertText(` `).replaceSelectionWith(br.create()).scrollIntoView());
        return true;
      });
    bind('Mod-Enter', cmd);
    bind('Shift-Enter', cmd);
    if (mac) bind('Ctrl-Enter', cmd);
  }
  const modEnter = mac ? 'Mod-Enter' : 'Ctrl-Enter';
  const enterCommands = [newlineInCode, createParagraphNear$1, liftEmptyBlock, splitBlock];
  if (schema.nodes.list_item) {
    enterCommands.unshift(enterKeyOnListCommand);

    // TODO: Remove hacky fix
    // This needs to done only when the editor sends messages on Enter.
    // Currently Mod+enter command is never reached as it is overridden at the editor
    //  side with Cmd+Enter for sending messages.
    // Fix this by using a different keymap or overriding existing keymap on condition.

    enterCommands.unshift(splitListItem(schema.nodes.list_item));
    if (schema.nodes.table) {
      const tabInTable = (state, dispatch) => goToNextCell(1)(state, dispatch) || addRowAfter(state, dispatch) && goToNextCell(1)(state, dispatch);
      bind("Tab", chainCommands(tabInTable, indentList()));
      bind("Shift-Tab", chainCommands(goToNextCell(-1), outdentList()));
    } else {
      bind("Tab", indentList());
      bind("Shift-Tab", outdentList());
    }
  } else if (schema.nodes.table) {
    bind('Tab', goToNextCell(1));
    bind('Shift-Tab', goToNextCell(-1));
  }
  bind('Enter', chainCommands.apply(null, enterCommands));
  bind(modEnter, chainCommands.apply(null, enterCommands));
  return keymap(keys);
}

const validCombos = {
  '**': ['_', '~~', '^'],
  '*': ['__', '~~', '^'],
  '^': ['*', '_'],
  __: ['*', '~~', '^'],
  _: ['**', '~~', '^'],
  '~~': ['__', '_', '**', '*', '^']
};
const validRegex = (char, str) => {
  for (let i = 0; i < validCombos[char].length; i++) {
    const ch = validCombos[char][i];
    if (ch === str) {
      return true;
    }
    const matchLength = str.length - ch.length;
    if (str.substr(matchLength, str.length) === ch) {
      return validRegex(ch, str.substr(0, matchLength));
    }
  }
  return false;
};
function addMark(markType, schema, charSize, char) {
  return (state, match, start, end) => {
    const [, prefix, textWithCombo] = match;
    const to = end;
    // in case of *string* pattern it matches the text from beginning of the paragraph,
    // because we want ** to work for strong text
    // that's why "start" argument is wrong and we need to calculate it ourselves
    const from = textWithCombo ? start + prefix.length : start;
    const nodeBefore = state.doc.resolve(start + prefix.length).nodeBefore;
    if (prefix && prefix.length > 0 && !validRegex(char, prefix) && !(nodeBefore && nodeBefore.type === state.schema.nodes.hard_break)) {
      return null;
    }
    // fixes the following case: my `*name` is *
    // expected result: should ignore special characters inside "code"
    if (state.schema.marks.code && state.schema.marks.code.isInSet(state.doc.resolve(from + 1).marks())) {
      return null;
    }

    // Prevent autoformatting across hardbreaks
    let containsHardBreak;
    state.doc.nodesBetween(from, to, node => {
      if (node.type === schema.nodes.hard_break) {
        containsHardBreak = true;
        return false;
      }
      return !containsHardBreak;
    });
    if (containsHardBreak) {
      return null;
    }

    // fixes autoformatting in heading nodes: # Heading *bold*
    // expected result: should not autoformat *bold*; <h1>Heading *bold*</h1>
    if (state.doc.resolve(from).sameParent(state.doc.resolve(to))) {
      if (!state.doc.resolve(from).parent.type.allowsMarkType(markType)) {
        return null;
      }
    }

    // apply mark to the range (from, to)
    let tr = state.tr.addMark(from, to, markType.create());
    if (charSize > 1) {
      // delete special characters after the text
      // Prosemirror removes the last symbol by itself, so we need to remove "charSize - 1" symbols
      tr = tr.delete(to - (charSize - 1), to);
    }
    return tr
    // delete special characters before the text
    .delete(from, from + charSize).removeStoredMark(markType);
  };
}
function addCodeMark(markType, specialChar) {
  return (state, match, start, end) => {
    if (match[1] && match[1].length > 0) {
      const allowedPrefixConditions = [prefix => {
        return prefix === '(';
      }, prefix => {
        const nodeBefore = state.doc.resolve(start + prefix.length).nodeBefore;
        return nodeBefore && nodeBefore.type === state.schema.nodes.hard_break || false;
      }];
      if (allowedPrefixConditions.every(condition => !condition(match[1]))) {
        return null;
      }
    }
    // fixes autoformatting in heading nodes: # Heading `bold`
    // expected result: should not autoformat *bold*; <h1>Heading `bold`</h1>
    if (state.doc.resolve(start).sameParent(state.doc.resolve(end))) {
      if (!state.doc.resolve(start).parent.type.allowsMarkType(markType)) {
        return null;
      }
    }
    let tr = state.tr;
    // checks if a selection exists and needs to be removed
    if (state.selection.from !== state.selection.to) {
      tr.delete(state.selection.from, state.selection.to);
      end -= state.selection.to - state.selection.from;
    }
    const regexStart = end - match[2].length + 1;
    const codeMark = state.schema.marks.code.create();
    return applyMarkOnRange(regexStart, end, false, codeMark, tr).setStoredMarks([codeMark]).delete(regexStart, regexStart + specialChar.length).removeStoredMark(markType);
  };
}
const strongRegex1 = /(\S*)(\_\_([^\_\s](\_(?!\_)|[^\_])*[^\_\s]|[^\_\s])\_\_)$/;
const strongRegex2 = /(\S*)(\*\*([^\*\s](\*(?!\*)|[^\*])*[^\*\s]|[^\*\s])\*\*)$/;
const italicRegex1 = /(\S*[^\s\_]*)(\_([^\s\_][^\_]*[^\s\_]|[^\s\_])\_)$/;
const italicRegex2 = /(\S*[^\s\*]*)(\*([^\s\*][^\*]*[^\s\*]|[^\s\*])\*)$/;
const strikeRegex = /(\S*)(\~\~([^\s\~](\~(?!\~)|[^\~])*[^\s\~]|[^\s\~])\~\~)$/;
const codeRegex = /(\S*)(`[^\s][^`]*`)$/;
const supertextRegex = /(\S*[^\s^]*)(\^([^\s^][^^]*[^\s^]|[^\s^])\^)$/;

/**
 * Create input rules for strong mark
 *
 * @param {Schema} schema
 * @returns {InputRule[]}
 */
function getStrongInputRules(schema) {
  // **string** or __strong__ should bold the text

  const markLength = 2;
  const doubleUnderscoreRule = createInputRule$1(strongRegex1, addMark(schema.marks.strong, schema, markLength, '__'));
  const doubleAsterixRule = createInputRule$1(strongRegex2, addMark(schema.marks.strong, schema, markLength, '**'));
  return [doubleUnderscoreRule, doubleAsterixRule];
}

/**
 * Create input rules for em mark
 *
 * @param {Schema} schema
 * @returns {InputRule[]}
 */
function getItalicInputRules(schema) {
  // *string* or _string_ should italic the text
  const markLength = 1;
  const underscoreRule = createInputRule$1(italicRegex1, addMark(schema.marks.em, schema, markLength, '_'));
  const asterixRule = createInputRule$1(italicRegex2, addMark(schema.marks.em, schema, markLength, '*'));
  return [underscoreRule, asterixRule];
}

/**
 * Create input rules for strike mark
 *
 * @param {Schema} schema
 * @returns {InputRule[]}
 */
function getStrikeInputRules(schema) {
  const markLength = 2;
  const doubleTildeRule = createInputRule$1(strikeRegex, addMark(schema.marks.strike, schema, markLength, '~~'));
  return [doubleTildeRule];
}
function getSuperscriptInputRules(schema) {
  const markLength = 1;
  // const doubleTildeRule = addMark(schema.marks.superscript);
  const doubleTildeRule = createInputRule$1(supertextRegex, addMark(schema.marks.superscript, schema, markLength, '^'));
  return [doubleTildeRule];
}

/**
 * Create input rules for code mark
 *
 * @param {Schema} schema
 * @returns {InputRule[]}
 */
function getCodeInputRules(schema) {
  const backTickRule = createInputRule$1(codeRegex, addCodeMark(schema.marks.code, '`'));
  return [backTickRule];
}
function textFormattingInputRules(schema) {
  const rules = [];
  if (schema.marks.strong) {
    rules.push(...getStrongInputRules(schema));
  }
  if (schema.marks.em) {
    rules.push(...getItalicInputRules(schema));
  }
  if (schema.marks.superscript) {
    rules.push(...getSuperscriptInputRules(schema));
  }
  if (schema.marks.strike) {
    rules.push(...getStrikeInputRules(schema));
  }
  if (schema.marks.code) {
    rules.push(...getCodeInputRules(schema));
  }
  if (rules.length !== 0) {
    return inputRules({
      rules
    });
  }
  return;
}

/* eslint-disable no-plusplus */
const prefix = 'ProseMirror-prompt';
function reportInvalid(dom, message) {
  // FIXME this is awful and needs a lot more work
  let parent = dom.parentNode;
  let msg = parent.appendChild(document.createElement('div'));
  msg.style.left = dom.offsetLeft + dom.offsetWidth + 2 + 'px';
  msg.style.top = dom.offsetTop - 5 + 'px';
  msg.className = 'ProseMirror-invalid';
  msg.textContent = message;
  setTimeout(() => parent.removeChild(msg), 1500);
}
function getValues(fields, domFields) {
  let result = Object.keys(fields).filter((name, index) => {
    let field = fields[name];
    let dom = domFields[index];
    let value = field.read(dom);
    let bad = field.validate(value);
    if (bad) reportInvalid(dom, bad);
    return !bad;
  }).reduce((acc, name, index) => {
    let field = fields[name];
    let dom = domFields[index];
    let value = field.read(dom);
    acc[name] = field.clean(value);
    return acc;
  }, {});
  return result;
}
function openPrompt(options) {
  // Use a native <dialog> element so it renders in the browser's top layer,
  // automatically appearing above everything including other open dialogs.
  let dialog = document.createElement('dialog');
  dialog.className = prefix + '-backdrop';

  // Create the prompt wrapper (the visible dialog box)
  let wrapper = document.createElement('div');
  wrapper.className = prefix;
  dialog.appendChild(wrapper);
  document.body.appendChild(dialog);
  dialog.showModal();
  const close = () => {
    if (dialog.open) dialog.close();
    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
  };

  // Close when clicking the backdrop (outside the wrapper)
  dialog.addEventListener('mousedown', e => {
    if (e.target === dialog) close();
  });

  // Handle native cancel event (e.g. Escape key)
  dialog.addEventListener('cancel', e => {
    e.preventDefault();
    close();
  });
  let domFields = [];
  Object.values(options.fields).map(field => domFields.push(field.render()));
  let submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button tiny button--save-link ' + prefix + '-submit';
  submitButton.textContent = 'Create Link';
  let cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'button tiny hollow secondary' + prefix + '-cancel';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', close);
  let form = wrapper.appendChild(document.createElement('form'));
  if (options.title) {
    const titleDom = document.createElement('h5');
    titleDom.className = 'sub-block-title';
    form.appendChild(titleDom).textContent = options.title;
  }
  domFields.forEach(field => {
    form.appendChild(document.createElement('div')).appendChild(field);
  });
  let buttons = form.appendChild(document.createElement('div'));
  buttons.className = prefix + '-buttons';
  buttons.appendChild(submitButton);
  buttons.appendChild(document.createTextNode(' '));
  buttons.appendChild(cancelButton);
  let submit = () => {
    let params = getValues(options.fields, domFields);
    if (params) {
      close();
      options.callback(params);
    }
  };
  form.addEventListener('submit', e => {
    e.preventDefault();
    submit();
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Esc') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Tab') {
      window.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) close();
      }, 500);
    }
  });
  let input = form.elements[0];
  if (input) input.focus();
}

/* eslint-disable class-methods-use-this */
// ::- The type of field that `FieldPrompt` expects to be passed to it.
class Field {
  // :: (Object)
  // Create a field with the given options. Options support by all
  // field types are:
  //
  // **`value`**`: ?any`
  //   : The starting value for the field.
  //
  // **`label`**`: string`
  //   : The label for the field.
  //
  // **`required`**`: ?bool`
  //   : Whether the field is required.
  //
  // **`validate`**`: ?(any) → ?string`
  //   : A function to validate the given value. Should return an
  //     error message if it is not valid.
  constructor(options) {
    this.options = options;
  }

  // render:: (state: EditorState, props: Object) → dom.Node
  // Render the field to the DOM. Should be implemented by all subclasses.

  // :: (dom.Node) → any
  // Read the field's value from its DOM node.
  read(dom) {
    return dom.value;
  }

  // :: (any) → ?string
  // A field-type-specific validation function.
  validateType() {}
  validate(value) {
    if (!value && this.options.required) return 'Required field';
    return this.validateType(value) || this.options.validate && this.options.validate(value);
  }
  clean(value) {
    return this.options.clean ? this.options.clean(value) : value;
  }
}

// ::- A field class for single-line text fields.
class TextField extends Field {
  render() {
    let input = document.createElement('input');
    input.type = 'text';
    input.placeholder = this.options.label;
    input.className = this.options.class;
    input.value = this.options.value || '';
    input.autocomplete = 'off';
    return input;
  }
}

const cmdItem = (cmd, options) => {
  const passedOptions = {
    label: options.title,
    run: cmd
  };
  Object.keys(options).reduce((acc, optionKey) => {
    acc[optionKey] = options[optionKey];
    return acc;
  }, passedOptions);
  if ((!options.enable || options.enable === true) && !options.select) {
    passedOptions[options.enable ? 'enable' : 'select'] = state => cmd(state);
  }
  return new MenuItem(passedOptions);
};
const markItem = (markType, options) => {
  const passedOptions = {
    active(state) {
      return markActive(state, markType);
    },
    enable: true
  };
  Object.keys(options).reduce((acc, optionKey) => {
    acc[optionKey] = options[optionKey];
    return acc;
  }, passedOptions);
  return cmdItem(toggleMark(markType), passedOptions);
};
const blockTypeIsActive = (state, type, attrs) => {
  const {
    $from
  } = state.selection;
  let wrapperDepth;
  let currentDepth = $from.depth;
  while (currentDepth > 0) {
    const currentNodeAtDepth = $from.node(currentDepth);
    ({
      ...attrs
    });
    if (currentNodeAtDepth.attrs.level) {
      currentNodeAtDepth.attrs.level;
    }
    const isType = type.name === currentNodeAtDepth.type.name;
    const hasAttrs = Object.keys(attrs).reduce((prev, curr) => {
      if (attrs[curr] !== currentNodeAtDepth.attrs[curr]) {
        return false;
      }
      return prev;
    }, true);
    if (isType && hasAttrs) {
      wrapperDepth = currentDepth;
    }
    currentDepth -= 1;
  }
  return wrapperDepth;
};
const toggleBlockType = (type, attrs) => (state, dispatch) => {
  const isActive = blockTypeIsActive(state, type, attrs);
  const newNodeType = isActive ? state.schema.nodes.paragraph : type;
  const setBlockFunction = setBlockType(newNodeType, attrs);
  return setBlockFunction(state, dispatch);
};

const BaseIcon = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  path: ""
};
const icons = {
  strong: {
    ...BaseIcon,
    path: "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"
  },
  em: {
    ...BaseIcon,
    path: "M19 4L10 4 M14 20L5 20 M15 4L9 20"
  },
  superScript: {
    ...BaseIcon,
    path: "M4 19l8-8 M12 19l-8-8 M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06"
  },
  code: {
    ...BaseIcon,
    path: "M16 18l6-6-6-6 M8 6l-6 6 6 6"
  },
  strike: {
    ...BaseIcon,
    path: "M16 4H9a3 3 0 0 0-2.83 4 M14 12a4 4 0 0 1 0 8H6 M4 12h16"
  },
  link: {
    ...BaseIcon,
    path: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
  },
  undo: {
    ...BaseIcon,
    path: "M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"
  },
  redo: {
    ...BaseIcon,
    path: "M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"
  },
  bulletList: {
    ...BaseIcon,
    path: "M8 6h13 M8 12h13 M8 18h13 M4 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0 M4 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0 M4 18a1 1 0 1 1-2 0 1 1 0 0 1 2 0"
  },
  orderedList: {
    ...BaseIcon,
    path: "M11 5h10 M11 12h10 M11 19h10 M4 4h1v5 M4 9h2 M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"
  },
  h1: {
    ...BaseIcon,
    path: "M4 12h8 M4 18V6 M12 18V6 M17 12l3-2v8"
  },
  h2: {
    ...BaseIcon,
    path: "M4 12h8 M4 18V6 M12 18V6 M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"
  },
  h3: {
    ...BaseIcon,
    path: "M4 12h8 M4 18V6 M12 18V6 M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2 M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"
  },
  image: {
    ...BaseIcon,
    path: "M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21 M14 19.5l3-3 3 3 M17 22v-5.5 M9 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"
  },
  table: {
    ...BaseIcon,
    path: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z M3 10h18 M3 15h18 M10 3v18 M15 3v18"
  },
  sparkles: {
    ...BaseIcon,
    path: "M19.5 13.5a1.48 1.48 0 0 1-.977 1.402l-4.835 1.786-1.782 4.84a1.491 1.491 0 0 1-2.8 0l-1.793-4.84-4.84-1.782a1.491 1.491 0 0 1 0-2.8l4.84-1.793 1.78-4.84a1.491 1.491 0 0 1 2.802 0l1.793 4.84 4.84 1.78c.59.216.98.778.972 1.407m-5.25-9h1.5V6a.75.75 0 0 0 1.5 0V4.5h1.5a.75.75 0 0 0 0-1.5h-1.5V1.5a.75.75 0 0 0-1.5 0V3h-1.5a.75.75 0 0 0 0 1.5m8.25 3h-.75v-.75a.75.75 0 0 0-1.5 0v.75h-.75a.75.75 0 0 0 0 1.5h.75v.75a.75.75 0 0 0 1.5 0V9h.75a.75.75 0 0 0 0-1.5m0 0"
  }
};

const wrapListItem = (nodeType, options) => cmdItem(wrapInList(nodeType, options.attrs), options);
const imageUploadItem = (nodeType, onImageUpload) => new MenuItem({
  title: "Upload image",
  icon: icons.image,
  enable() {
    return true;
  },
  run() {
    onImageUpload();
    return true;
  }
});
const copilotItem = (nodeType, onCopilotClick) => {
  return new MenuItem({
    title: "Copilot",
    icon: icons.sparkles,
    class: "ProseMirror-copilot",
    run: () => {
      onCopilotClick();
      return true;
    },
    enable() {
      return true;
    }
  });
};
const headerItem = (nodeType, options) => {
  const {
    level = 1
  } = options;
  return new MenuItem({
    title: `Heading ${level}`,
    icon: options.icon,
    active(state) {
      return blockTypeIsActive(state, nodeType, {
        level
      });
    },
    enable() {
      return true;
    },
    run(state, dispatch, view) {
      if (blockTypeIsActive(state, nodeType, {
        level
      })) {
        toggleBlockType(nodeType, {
          level
        })(state, dispatch);
        return true;
      }
      toggleBlockType(nodeType, {
        level
      })(view.state, view.dispatch);
      view.focus();
      return false;
    }
  });
};
const linkItem = markType => new MenuItem({
  title: "Add or remove link",
  icon: icons.link,
  active(state) {
    return markActive(state, markType);
  },
  enable(state) {
    return !state.selection.empty;
  },
  run(state, dispatch, view) {
    if (markActive(state, markType)) {
      toggleMark(markType)(state, dispatch);
      return true;
    }
    openPrompt({
      title: "Create a link",
      fields: {
        href: new TextField({
          label: "https://example.com",
          class: "small",
          required: true
        })
      },
      callback(attrs) {
        toggleMark(markType, attrs)(view.state, view.dispatch);
        view.focus();
      }
    });
    return false;
  }
});
const isInsideTable = (state, schema) => {
  const {
    $from
  } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === schema.nodes.table) return true;
  }
  return false;
};
const insertTableItem = schema => new MenuItem({
  title: "Insert table",
  icon: icons.table,
  enable(state) {
    if (!schema.nodes.table) return false;
    return !isInsideTable(state, schema);
  },
  run(state, dispatch) {
    const {
      table,
      table_row,
      table_header,
      table_cell,
      paragraph
    } = schema.nodes;
    const headerCells = [0, 1, 2].map(() => table_header.createAndFill(null, paragraph.create()));
    const dataCells = [0, 1, 2].map(() => table_cell.createAndFill(null, paragraph.create()));
    const headerRow = table_row.create(null, headerCells);
    const dataRow = table_row.create(null, dataCells);
    const tableNode = table.create(null, [headerRow, dataRow]);
    dispatch(state.tr.replaceSelectionWith(tableNode).scrollIntoView());
    return true;
  }
});

// Items that should be hidden when selection is inside a table
const HIDE_IN_TABLE = new Set(['bulletList', 'orderedList', 'h1', 'h2', 'h3', 'imageUpload', 'code', 'insertTable', 'strike', 'copilot']);

// Wrap a MenuItem so it's hidden (select → false) when inside a table
const hideInTable = (key, item, schema) => {
  if (!item || !schema.nodes.table || !HIDE_IN_TABLE.has(key)) return item;
  return new MenuItem({
    ...item.spec,
    select: state => !isInsideTable(state, schema)
  });
};
const buildMenuOptions = (schema, {
  enabledMenuOptions = ["strong", "em", "code", "link", "undo", "redo", "bulletList", "orderedList"],
  onImageUpload = () => {},
  onCopilotClick = () => {}
}) => {
  const availableMenuOptions = {
    strong: markItem(schema.marks.strong, {
      title: "Toggle strong style",
      icon: icons.strong
    }),
    em: markItem(schema.marks.em, {
      title: "Toggle emphasis",
      icon: icons.em
    }),
    code: markItem(schema.marks.code, {
      title: "Toggle code font",
      icon: icons.code
    }),
    strike: markItem(schema.marks.strike, {
      title: "Toggle strikethrough",
      icon: icons.strike
    }),
    link: linkItem(schema.marks.link),
    bulletList: wrapListItem(schema.nodes.bullet_list, {
      title: "Wrap in bullet list",
      icon: icons.bulletList
    }),
    orderedList: wrapListItem(schema.nodes.ordered_list, {
      title: "Wrap in ordered list",
      icon: icons.orderedList
    }),
    undo: new MenuItem({
      title: "Undo last change",
      run: undo,
      enable: state => undo(state),
      icon: icons.undo
    }),
    redo: new MenuItem({
      title: "Redo last undone change",
      run: redo,
      enable: state => redo(state),
      icon: icons.redo
    }),
    h1: headerItem(schema.nodes.heading, {
      level: 1,
      title: "Toggle code font",
      icon: icons.h1
    }),
    h2: headerItem(schema.nodes.heading, {
      level: 2,
      title: "Toggle code font",
      icon: icons.h2
    }),
    h3: headerItem(schema.nodes.heading, {
      level: 3,
      title: "Toggle code font",
      icon: icons.h3
    }),
    imageUpload: imageUploadItem(schema.nodes.image, onImageUpload),
    insertTable: schema.nodes.table ? insertTableItem(schema) : null,
    copilot: copilotItem(schema.nodes.copilot, onCopilotClick)
  };
  return [enabledMenuOptions.filter(menuOptionKey => !!availableMenuOptions[menuOptionKey]).map(key => hideInTable(key, availableMenuOptions[key], schema))];
};

/**
 * Takes a slice of pasted content and returns a new slice with link
 * marks applied to any bare URLs found in text nodes.
 */
function linkifySlice(slice, schema) {
  const linkMarkType = schema.marks.link;
  if (!linkMarkType) return slice;
  const fragment = linkifyFragment(slice.content, schema, linkMarkType, null);
  return new Slice(fragment, slice.openStart, slice.openEnd);
}

/**
 * Recursively walks a fragment and applies link marks to bare URLs
 * in text nodes.
 */
function linkifyFragment(fragment, schema, linkMarkType, parentNode) {
  const nodes = [];
  fragment.forEach(node => {
    if (node.isText) {
      nodes.push(...linkifyTextNode(node, schema, linkMarkType, parentNode));
    } else if (node.content.size > 0) {
      nodes.push(node.copy(linkifyFragment(node.content, schema, linkMarkType, node)));
    } else {
      nodes.push(node);
    }
  });
  return Fragment.fromArray(nodes);
}

/**
 * Takes a text node and splits it into multiple nodes where bare URLs
 * get a link mark applied. Returns an array of nodes.
 */
function linkifyTextNode(node, schema, linkMarkType, parentNode) {
  if (parentNode && !parentNode.type.allowsMarkType(linkMarkType)) return [node];

  // Skip if already has a link mark
  if (linkMarkType.isInSet(node.marks)) return [node];
  const matches = linkify.match(node.text);
  if (!matches || matches.length === 0) return [node];
  const nodes = [];
  let lastIndex = 0;
  matches.forEach(match => {
    const url = normalizeUrl(match.url);
    if (!url) return;

    // Text before the URL
    if (match.index > lastIndex) {
      nodes.push(schema.text(node.text.slice(lastIndex, match.index), node.marks));
    }

    // The URL with link mark
    const linkMark = linkMarkType.create({
      href: url
    });
    nodes.push(schema.text(node.text.slice(match.index, match.lastIndex), linkMark.addToSet(node.marks)));
    lastIndex = match.lastIndex;
  });

  // Remaining text after last URL
  if (lastIndex < node.text.length) {
    nodes.push(schema.text(node.text.slice(lastIndex), node.marks));
  }
  return nodes;
}

/**
 * ProseMirror plugin that automatically converts bare URLs into
 * proper link marks in pasted content.
 *
 * Typed URLs are handled by the existing linksInputRules (on space).
 * This plugin covers the paste case where URLs would otherwise
 * remain as plain text.
 */
function autoLinkURLs(schema) {
  if (!schema.marks.link) return null;
  return new Plugin({
    props: {
      transformPasted(slice) {
        return linkifySlice(slice, schema);
      }
    }
  });
}

// ── Helpers ──

const PLUS_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const GRIP_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg>';
const isRTL = el => getComputedStyle(el || document.documentElement).direction === "rtl";

// ── Table Controls Plugin ──
// + buttons (add row/col at end) + grip handles with dropdown menus

function tableControlsPlugin(schema) {
  if (!schema.nodes.table) return null;
  let currentTableEl = null;
  let hideTimer = null;
  let editorView = null;

  // + buttons
  let rowBtn = null;
  let colBtn = null;

  // Grip handles
  let rowGrip = null;
  let colGrip = null;
  let hoveredCell = null;

  // Dropdown menu
  let menuEl = null;

  // ── Element factories ──

  const makeAddBtn = onClick => {
    const btn = document.createElement("button");
    btn.innerHTML = PLUS_SVG;
    btn.className = "pm-table-add-btn";
    btn.setAttribute("contenteditable", "false");
    btn.style.cssText = "position:fixed;z-index:5;border:none;cursor:pointer;" + "display:none;align-items:center;justify-content:center;padding:0;" + "transition:background .15s,color .15s;";
    btn.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    btn.addEventListener("mouseleave", () => scheduleHide());
    btn.addEventListener("mousedown", e => {
      e.preventDefault();
      onClick();
    });
    document.body.appendChild(btn);
    return btn;
  };
  const makeGrip = onClick => {
    const el = document.createElement("button");
    el.innerHTML = GRIP_SVG;
    el.className = "pm-table-grip";
    el.setAttribute("contenteditable", "false");
    el.style.cssText = "position:fixed;z-index:6;border:none;cursor:grab;" + "display:none;align-items:center;justify-content:center;padding:0;" + "border-radius:3px;transition:background .1s,color .1s;";
    el.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    el.addEventListener("mouseleave", () => {
      if (!menuEl) scheduleHide();
    });
    el.addEventListener("mousedown", e => {
      e.preventDefault();
      onClick(el);
    });
    document.body.appendChild(el);
    return el;
  };

  // ── Dropdown menu ──

  const removeMenu = () => {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  };
  const showMenu = (anchorEl, items) => {
    removeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "pm-table-menu";
    menuEl.style.cssText = "position:fixed;z-index:100;font-family:inherit;";
    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "pm-table-menu-separator";
        menuEl.appendChild(sep);
        return;
      }
      const btn = document.createElement("button");
      btn.textContent = item.label;
      btn.className = "pm-table-menu-item" + (item.danger ? " pm-table-menu-item--danger" : "");
      btn.addEventListener("mousedown", e => {
        e.preventDefault();
        removeMenu();
        item.action();
      });
      menuEl.appendChild(btn);
    });
    document.body.appendChild(menuEl);

    // Position below the anchor
    const ar = anchorEl.getBoundingClientRect();
    menuEl.style.left = ar.left + "px";
    menuEl.style.top = ar.bottom + 4 + "px";

    // Keep in viewport
    const mr = menuEl.getBoundingClientRect();
    if (mr.right > window.innerWidth) menuEl.style.left = window.innerWidth - mr.width - 8 + "px";
    if (mr.bottom > window.innerHeight) menuEl.style.top = ar.top - mr.height - 4 + "px";

    // Close on click outside
    const onClickOutside = e => {
      if (menuEl && !menuEl.contains(e.target)) {
        removeMenu();
        document.removeEventListener("mousedown", onClickOutside, true);
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", onClickOutside, true);
    }, 0);
  };

  // ── Show / Hide / Position ──

  const ensureElements = () => {
    if (rowBtn) return;
    rowBtn = makeAddBtn(execAddRow);
    rowBtn.style.borderRadius = "0 0 4px 4px";
    colBtn = makeAddBtn(execAddCol);
    rowGrip = makeGrip(onRowGripClick);
    colGrip = makeGrip(onColGripClick);
  };
  const show = tableEl => {
    clearTimeout(hideTimer);
    currentTableEl = tableEl;
    ensureElements();
    positionAddButtons();
    rowBtn.style.display = "flex";
    colBtn.style.display = "flex";
  };

  // Get the visible boundary — .tableWrapper if it exists, otherwise the editor DOM
  const getVisibleBounds = () => {
    if (!currentTableEl || !editorView) return null;
    const wrapper = currentTableEl.closest(".tableWrapper");
    if (wrapper) return wrapper.getBoundingClientRect();
    // No tableWrapper — use the editor's content area as visible bounds
    return editorView.dom.getBoundingClientRect();
  };
  const positionAddButtons = () => {
    if (!currentTableEl || !rowBtn || !editorView) return;
    const vr = getVisibleBounds(); // visible rect (for horizontal bounds)
    if (!vr) return;
    const tr = currentTableEl.getBoundingClientRect(); // table rect (for vertical bounds)
    const rtl = isRTL(currentTableEl);

    // Row button: spans visible width, below the table
    rowBtn.style.left = vr.left + "px";
    rowBtn.style.top = tr.bottom + "px";
    rowBtn.style.width = vr.width + "px";
    rowBtn.style.height = "18px";

    // Col button: at the visible right edge, table's vertical position & height
    colBtn.style.display = "flex";
    if (rtl) {
      colBtn.style.left = vr.left - 20 + "px";
      colBtn.style.borderRadius = "4px 0 0 4px";
    } else {
      colBtn.style.left = vr.right + 2 + "px";
      colBtn.style.borderRadius = "0 4px 4px 0";
    }
    colBtn.style.top = tr.top + "px";
    colBtn.style.width = "18px";
    colBtn.style.height = tr.height + "px";
  };
  const positionGrips = cellEl => {
    if (!currentTableEl || !rowGrip || !cellEl) return;
    const vr = getVisibleBounds(); // horizontal bounds
    if (!vr) return;
    const tr = currentTableEl.getBoundingClientRect(); // table vertical bounds
    const cr = cellEl.getBoundingClientRect();
    const rtl = isRTL(currentTableEl);

    // Column grip: above the table, centered on the hovered column
    colGrip.style.left = cr.left + cr.width / 2 - 8 + "px";
    colGrip.style.top = tr.top - 16 + "px";
    colGrip.style.width = "16px";
    colGrip.style.height = "14px";
    colGrip.style.display = "flex";

    // Row grip: to the left (or right in RTL), aligned with the hovered row
    const rowEl = cellEl.closest("tr");
    if (rowEl) {
      const rr = rowEl.getBoundingClientRect();
      if (rtl) {
        rowGrip.style.left = vr.right + 4 + "px";
      } else {
        rowGrip.style.left = vr.left - 18 + "px";
      }
      rowGrip.style.top = rr.top + rr.height / 2 - 7 + "px";
      rowGrip.style.width = "14px";
      rowGrip.style.height = "16px";
      rowGrip.style.display = "flex";
    }
  };
  const hide = () => {
    currentTableEl = null;
    hoveredCell = null;
    [rowBtn, colBtn, rowGrip, colGrip].forEach(el => {
      if (el) el.style.display = "none";
    });
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 300);
  };

  // ── Table helpers ──

  const findTableInfo = () => {
    if (!currentTableEl || !editorView) return null;
    try {
      const pos = editorView.posAtDOM(currentTableEl, 0);
      const $pos = editorView.state.doc.resolve(pos);
      for (let d = $pos.depth; d >= 0; d--) {
        if ($pos.node(d).type === schema.nodes.table) return {
          node: $pos.node(d),
          start: $pos.before(d)
        };
      }
    } catch (_) {}
    return null;
  };
  const selectCellAndRun = (offset, command) => {
    if (!editorView) return;
    try {
      const sel = editorView.state.selection.constructor.near(editorView.state.doc.resolve(offset));
      editorView.dispatch(editorView.state.tr.setSelection(sel));
      command(editorView.state, editorView.dispatch);
      editorView.focus();
      requestAnimationFrame(positionAddButtons);
    } catch (_) {}
  };
  const selectRowCells = rowEl => {
    if (!editorView || !rowEl) return;
    try {
      const first = rowEl.children[0];
      const last = rowEl.children[rowEl.children.length - 1];
      const $f = editorView.state.doc.resolve(editorView.posAtDOM(first, 0));
      const $l = editorView.state.doc.resolve(editorView.posAtDOM(last, 0));
      editorView.dispatch(editorView.state.tr.setSelection(CellSelection.create(editorView.state.doc, $f.before($f.depth), $l.before($l.depth))));
    } catch (_) {}
  };
  const selectColCells = cellEl => {
    if (!editorView || !currentTableEl) return;
    try {
      const row = cellEl.closest("tr");
      const colIdx = Array.from(row.children).indexOf(cellEl);
      const rows = currentTableEl.querySelectorAll("tr");
      const first = rows[0].children[colIdx];
      const last = rows[rows.length - 1].children[colIdx];
      const $f = editorView.state.doc.resolve(editorView.posAtDOM(first, 0));
      const $l = editorView.state.doc.resolve(editorView.posAtDOM(last, 0));
      editorView.dispatch(editorView.state.tr.setSelection(CellSelection.create(editorView.state.doc, $f.before($f.depth), $l.before($l.depth))));
    } catch (_) {}
  };
  const clearSelectedCells = () => {
    if (!editorView) return;
    const sel = editorView.state.selection;
    if (!(sel instanceof CellSelection)) return;
    let tr = editorView.state.tr;
    sel.forEachCell((cell, pos) => {
      const start = pos + 1;
      const end = pos + cell.nodeSize - 1;
      if (end > start) {
        tr = tr.replaceWith(tr.mapping.map(start), tr.mapping.map(end), schema.nodes.paragraph.create());
      }
    });
    editorView.dispatch(tr);
    editorView.focus();
  };

  // ── + button actions ──

  const execAddRow = () => {
    const info = findTableInfo();
    if (!info) return;
    const {
      node: tableNode,
      start: tableStart
    } = info;
    let offset = tableStart + 1;
    for (let r = 0; r < tableNode.childCount - 1; r++) offset += tableNode.child(r).nodeSize;
    offset += 2;
    selectCellAndRun(offset, addRowAfter);
  };
  const execAddCol = () => {
    const info = findTableInfo();
    if (!info) return;
    const {
      node: tableNode,
      start: tableStart
    } = info;
    const firstRow = tableNode.child(0);
    let offset = tableStart + 2;
    for (let c = 0; c < firstRow.childCount - 1; c++) offset += firstRow.child(c).nodeSize;
    offset += 1;
    selectCellAndRun(offset, addColumnAfter);
  };

  // ── Grip actions ──

  const onRowGripClick = gripEl => {
    if (!hoveredCell) return;
    const rowEl = hoveredCell.closest("tr");
    const isHeaderRow = hoveredCell.tagName === "TH";
    selectRowCells(rowEl);
    const items = [];
    if (!isHeaderRow) {
      items.push({
        label: "Insert above",
        action: () => addRowBefore(editorView.state, editorView.dispatch)
      });
    }
    items.push({
      label: "Insert below",
      action: () => addRowAfter(editorView.state, editorView.dispatch)
    });
    items.push({
      separator: true
    });
    items.push({
      label: "Clear contents",
      action: clearSelectedCells
    });
    if (!isHeaderRow) {
      items.push({
        label: "Delete row",
        danger: true,
        action: () => {
          deleteRow(editorView.state, editorView.dispatch);
          editorView.focus();
        }
      });
    }
    items.push({
      separator: true
    });
    items.push({
      label: "Delete table",
      danger: true,
      action: () => {
        deleteTable(editorView.state, editorView.dispatch);
        editorView.focus();
      }
    });
    showMenu(gripEl, items);
  };
  const onColGripClick = gripEl => {
    if (!hoveredCell) return;
    selectColCells(hoveredCell);
    showMenu(gripEl, [{
      label: "Insert left",
      action: () => addColumnBefore(editorView.state, editorView.dispatch)
    }, {
      label: "Insert right",
      action: () => addColumnAfter(editorView.state, editorView.dispatch)
    }, {
      separator: true
    }, {
      label: "Clear contents",
      action: clearSelectedCells
    }, {
      label: "Delete column",
      danger: true,
      action: () => {
        deleteColumn(editorView.state, editorView.dispatch);
        editorView.focus();
      }
    }, {
      separator: true
    }, {
      label: "Delete table",
      danger: true,
      action: () => {
        deleteTable(editorView.state, editorView.dispatch);
        editorView.focus();
      }
    }]);
  };

  // ── Plugin ──

  return new Plugin({
    key: new PluginKey("tableControls"),
    props: {
      handleDOMEvents: {
        mousemove(view, event) {
          editorView = view;
          const cellEl = event.target.closest && event.target.closest("td, th");
          const tableEl = event.target.closest && (event.target.closest("table") || event.target.closest(".tableWrapper") && event.target.closest(".tableWrapper").querySelector("table"));
          if (tableEl && view.dom.contains(tableEl)) {
            if (currentTableEl !== tableEl) show(tableEl);else clearTimeout(hideTimer);
            if (cellEl && cellEl !== hoveredCell) {
              hoveredCell = cellEl;
              positionGrips(cellEl);
            }
          } else if (currentTableEl) {
            scheduleHide();
          }
          return false;
        },
        mouseleave() {
          if (!menuEl) scheduleHide();
          return false;
        }
      }
    },
    view(view) {
      editorView = view;

      // Reposition controls on scroll (rAF-throttled to avoid jank)
      let scrollRAF = null;
      const onScroll = () => {
        if (!currentTableEl) return;
        removeMenu();
        if (scrollRAF) return;
        scrollRAF = requestAnimationFrame(() => {
          scrollRAF = null;
          if (currentTableEl) {
            positionAddButtons();
            if (hoveredCell) positionGrips(hoveredCell);
          }
        });
      };
      window.addEventListener("scroll", onScroll, true);
      return {
        update() {
          if (currentTableEl) {
            if (!document.body.contains(currentTableEl)) hide();else positionAddButtons();
          }
        },
        destroy() {
          clearTimeout(hideTimer);
          if (scrollRAF) cancelAnimationFrame(scrollRAF);
          removeMenu();
          window.removeEventListener("scroll", onScroll, true);
          [rowBtn, colBtn, rowGrip, colGrip].forEach(el => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
          });
          rowBtn = colBtn = rowGrip = colGrip = null;
        }
      };
    }
  });
}

function filterMdToPmSchemaMapping(schema, map) {
  return Object.keys(map).reduce((newMap, key) => {
    const value = map[key];
    const block = value.block || value.node;
    const mark = value.mark;
    if (block && schema.nodes[block] || mark && schema.marks[mark]) {
      newMap[key] = value;
    }
    return newMap;
  }, {});
}
const baseSchemaToMdMapping = {
  nodes: {
    blockquote: 'blockquote',
    paragraph: 'paragraph',
    code_block: ['code', 'fence'],
    list_item: 'list'
  },
  marks: {
    em: 'emphasis',
    superscript: 'sup',
    strong: 'text',
    link: ['link', 'autolink', 'reference', 'linkify'],
    strike: 'strikethrough',
    code: 'backticks'
  }
};
const baseNodesMdToPmMapping = {
  blockquote: {
    block: 'blockquote'
  },
  paragraph: {
    block: 'paragraph'
  },
  softbreak: {
    node: 'hard_break'
  },
  hardbreak: {
    node: 'hard_break'
  },
  code_block: {
    block: 'code_block'
  },
  fence: {
    block: 'code_block',
    // we trim any whitespaces around language definition
    attrs: tok => ({
      language: tok.info && tok.info.trim() || null
    })
  },
  list_item: {
    block: 'list_item'
  },
  bullet_list: {
    block: 'bullet_list'
  },
  ordered_list: {
    block: 'ordered_list',
    attrs: tok => ({
      order: +tok.attrGet('order') || 1
    })
  },
  image: {
    node: 'image',
    getAttrs: tok => {
      const src = tok.attrGet('src');
      const heightMatch = src.match(/cw_image_height=(\d+)px/);
      return {
        src,
        title: tok.attrGet('title') || null,
        alt: tok.children[0] && tok.children[0].content || null,
        height: heightMatch ? `${heightMatch[1]}px` : null
      };
    }
  },
  table: {
    block: 'table'
  },
  tr: {
    block: 'table_row'
  },
  th: {
    block: 'table_header'
  },
  td: {
    block: 'table_cell'
  }
};
const baseMarksMdToPmMapping = {
  em: {
    mark: 'em'
  },
  sup: {
    mark: 'superscript'
  },
  strong: {
    mark: 'strong'
  },
  link: {
    mark: 'link',
    attrs: tok => ({
      href: tok.attrGet('href'),
      title: tok.attrGet('title') || null
    })
  },
  code_inline: {
    mark: 'code'
  },
  s: {
    mark: 'strike'
  }
};

const messageSchemaToMdMapping = {
  nodes: {
    ...baseSchemaToMdMapping.nodes
  },
  marks: {
    ...baseSchemaToMdMapping.marks
  }
};
const messageMdToPmMapping = {
  ...baseNodesMdToPmMapping,
  ...baseMarksMdToPmMapping,
  mention: {
    node: 'mention',
    getAttrs: ({
      mention
    }) => {
      const {
        userId,
        userFullName,
        mentionType = 'user'
      } = mention;
      const attrs = {
        userId,
        userFullName,
        mentionType
      };
      return attrs;
    }
  },
  tools: {
    node: 'tools',
    getAttrs: ({
      tools
    }) => {
      const {
        id,
        name
      } = tools;
      return {
        id,
        name
      };
    }
  }
};
const md$1 = MarkdownIt('commonmark', {
  html: false,
  linkify: false
});
md$1.enable([
// Process html entity - &#123;, &#xAF;, &quot;, ...
'entity',
// Process escaped chars and hardbreaks
'escape']);
md$1.disable(['table', 'hr', 'heading', 'lheading'], true);
class MessageMarkdownTransformer {
  constructor(schema, tokenizer = md$1) {
    // Enable markdown plugins based on schema
    ['nodes', 'marks'].forEach(key => {
      for (const idx in messageSchemaToMdMapping[key]) {
        if (schema[key][idx]) {
          tokenizer.enable(messageSchemaToMdMapping[key][idx]);
        }
      }
    });
    this.markdownParser = new MarkdownParser(schema, tokenizer, filterMdToPmSchemaMapping(schema, messageMdToPmMapping));
  }
  encode(_node) {
    throw new Error('This is not implemented yet');
  }
  parse(content) {
    return this.markdownParser.parse(content);
  }
}

const articleSchemaToMdMapping = {
  nodes: {
    ...baseSchemaToMdMapping.nodes,
    rule: 'hr',
    heading: ['heading'],
    image: 'image',
    table: 'table'
  },
  marks: {
    ...baseSchemaToMdMapping.marks
  }
};
const articleMdToPmMapping = {
  ...baseNodesMdToPmMapping,
  ...baseMarksMdToPmMapping,
  hr: {
    node: 'horizontal_rule'
  },
  heading: {
    block: 'heading',
    attrs: tok => ({
      level: +tok.tag.slice(1)
    })
  },
  mention: {
    node: 'mention',
    getAttrs: ({
      mention
    }) => {
      const {
        userId,
        userFullName
      } = mention;
      return {
        userId,
        userFullName
      };
    }
  }
};
const md = MarkdownIt('commonmark', {
  html: false,
  linkify: true,
  breaks: true
}).use(MarkdownItSup);
md.enable([
// Process html entity - &#123;, &#xAF;, &quot;, ...
'entity',
// Process escaped chars and hardbreaks
'escape', 'hr']);

// Preprocess markdown-it table tokens for ProseMirror compatibility:
// 1. Strip thead/tbody wrappers — ProseMirror tables have no equivalent nodes.
// 2. Wrap cell (th/td) inline content in paragraph tokens — ProseMirror table cells
//    require block content (content: 'block+'), but markdown-it emits raw inline tokens.
const SKIP_TABLE_TOKENS = new Set(['thead_open', 'thead_close', 'tbody_open', 'tbody_close']);
const CELL_OPEN_TOKENS = new Set(['th_open', 'td_open']);
const CELL_CLOSE_TOKENS = new Set(['th_close', 'td_close']);
const originalParse = md.parse.bind(md);
md.parse = (src, env) => {
  const tokens = originalParse(src, env);
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (SKIP_TABLE_TOKENS.has(t.type)) continue;
    if (CELL_OPEN_TOKENS.has(t.type)) {
      result.push(t);
      result.push({
        type: 'paragraph_open',
        tag: 'p',
        nesting: 1,
        attrs: null,
        content: ''
      });
    } else if (CELL_CLOSE_TOKENS.has(t.type)) {
      result.push({
        type: 'paragraph_close',
        tag: 'p',
        nesting: -1,
        attrs: null,
        content: ''
      });
      result.push(t);
    } else {
      result.push(t);
    }
  }
  return result;
};
class ArticleMarkdownTransformer {
  constructor(schema, tokenizer = md) {
    // Enable markdown plugins based on schema
    ['nodes', 'marks'].forEach(key => {
      for (const idx in articleSchemaToMdMapping[key]) {
        if (schema[key][idx]) {
          tokenizer.enable(articleSchemaToMdMapping[key][idx]);
        }
      }
    });
    this.markdownParser = new MarkdownParser(schema, tokenizer, filterMdToPmSchemaMapping(schema, articleMdToPmMapping));
  }
  encode(_node) {
    throw new Error('This is not implemented yet');
  }
  parse(content) {
    return this.markdownParser.parse(content);
  }
}

// Block elements that handle their own spacing (no backslash needed adjacent to these)
const BLOCK_TYPES = new Set(['blockquote', 'code_block', 'bullet_list', 'ordered_list', 'heading', 'horizontal_rule', 'table']);
const MARKDOWN_PATTERNS = {
  // CommonMark list markers: "* ", "- ", "+ " or "1. ", "1) " (up to 9 digits)
  list: /^([*\-+]|\d{1,9}[.)])\s/,
  // Block-level markdown syntax that should not be preceded by backslash
  // Includes: blockquote (>), ATX headings (#), fenced code (``` or ~~~), thematic breaks (--, ---, ***, ___)
  blockStart: /^(>\s?|#{1,6}\s|```|~~~|[-*_]{2,}$)/,
  // Markdown table rows: lines starting with "|" (data rows, header rows, separator rows like |---|)
  tableRow: /^\|/
};

/**
 * Checks if a paragraph node is empty (no visible content).
 * Empty = no trimmed text AND (no children OR only whitespace text nodes)
 * Edge cases handled:
 * - Truly empty: <p></p> → true
 * - Whitespace only: <p>   </p> → true
 * - Has image/mention: <p><image/></p> → false (not empty)
 * - Has text: <p>hello</p> → false (not empty)
 */
const isEmptyParagraph = node => {
  if (node.type.name !== 'paragraph') return false;
  if (!node.textContent.trim()) {
    // No visible text - verify it only contains text nodes (not images/mentions/etc.)
    for (let i = 0; i < node.childCount; i++) {
      if (!node.child(i).isText) return false;
    }
    return true;
  }
  return false;
};

/**
 * Checks if text starts with markdown syntax that should not be preceded by backslash.
 * Combines list syntax and block syntax detection for efficiency.
 * Detects:
 * - List markers: *, -, +, 1., 2), etc.
 * - Blockquotes: >
 * - Headings: #, ##, ###, etc.
 * - Code fences: ```, ~~~
 * - Thematic breaks: ---, ***, ___
 */
const startsWithMarkdownSyntax = text => {
  if (!text) return false;
  const trimmed = text.trim();
  return MARKDOWN_PATTERNS.list.test(trimmed) || MARKDOWN_PATTERNS.blockStart.test(trimmed) || MARKDOWN_PATTERNS.tableRow.test(trimmed);
};

// Find first non-empty sibling (skips multiple empty paragraphs)
// dir: 1 = next, -1 = prev | Returns node type name or null
const findNonEmptySibling = (parent, index, dir) => {
  for (let i = index + dir; dir > 0 ? i < parent.childCount : i >= 0; i += dir) {
    const child = parent.child(i);
    if (!isEmptyParagraph(child)) return child.type.name;
  }
  return null;
};

// True if nearest non-empty sibling (either direction) is a block element
// Edge case: multiple empty paragraphs before block → all skip backslash
const adjacentToBlock = (parent, index) => BLOCK_TYPES.has(findNonEmptySibling(parent, index, 1)) || BLOCK_TYPES.has(findNonEmptySibling(parent, index, -1));

// True if any sibling after `start` has content (text or children)
const hasContentAfter = (parent, start) => {
  for (let i = start; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (child.childCount || child.textContent.trim()) return true;
  }
  return false;
};

/**
 * Markdown Serializer
*/
const mention = (state, node) => {
  const userId = String(node.attrs.userId || '');
  const displayName = node.attrs.userFullName || '';
  const mentionType = node.attrs.mentionType || 'user';
  const uri = state.esc(`mention://${mentionType}/${userId}/${encodeURIComponent(displayName)}`);
  const escapedDisplayName = state.esc(`@${displayName}`);
  state.write(`[${escapedDisplayName}](${uri})`);
};
const tools = (state, node) => {
  const uri = state.esc(`tool://${node.attrs.id}`);
  const escapedDisplayName = state.esc(`@${node.attrs.name}`);
  state.write(`[${escapedDisplayName}](${uri})`);
};
const blockquote = (state, node) => {
  state.wrapBlock('> ', null, node, () => state.renderContent(node));
};
const code_block = (state, node) => {
  state.write('```' + (node.attrs.params || '') + '\n');
  state.text(node.textContent, false);
  state.ensureNewLine();
  state.write('```');
  state.closeBlock(node);
};
const heading = (state, node) => {
  state.write(state.repeat('#', node.attrs.level) + ' ');
  state.renderInline(node);
  state.closeBlock(node);
};
const horizontal_rule = (state, node) => {
  state.write(node.attrs.markup || '---');
  state.closeBlock(node);
};
const bullet_list = (state, node) => {
  state.renderList(node, '  ', () => (node.attrs.bullet || '*') + ' ');
};
const ordered_list = (state, node) => {
  let start = node.attrs.order || 1;
  let maxW = String(start + node.childCount - 1).length;
  let space = state.repeat(' ', maxW + 2);
  state.renderList(node, space, i => {
    let nStr = String(start + i);
    return state.repeat(' ', maxW - nStr.length) + nStr + '. ';
  });
};
const list_item = (state, node) => {
  state.renderContent(node);
};

// Paragraph (Enter key)
// Fixes: Unwanted backslash appearing before blocks or in empty lines
// - Empty near block (list/blockquote/code) → "\n" (no backslash)
// - Empty between text → "\\\n" (preserves blank line)
// - Trailing empty / signature removed → "\n" (no literal "\")
// - Single empty doc → nothing | In table → normal render
const paragraph = (state, node, parent, index) => {
  if (isEmptyParagraph(node) && !state.inTable) {
    if (parent.childCount === 1) return;
    if (adjacentToBlock(parent, index)) return state.write('\n');
    state.write(index > 0 && hasContentAfter(parent, index + 1) ? '\\\n' : '\n');
  } else {
    state.renderInline(node);
    state.closeBlock(node);
  }
};
const image = (state, node) => {
  let src = state.esc(node.attrs.src);
  if (node.attrs.height) {
    const param = `cw_image_height=${node.attrs.height}`;
    if (src.includes('?')) {
      src = src.includes('cw_image_height=') ? src.replace(/cw_image_height=[^&]+/, param) : `${src}&${param}`;
    } else {
      src += `?${param}`;
    }
  }
  state.write('![' + state.esc(node.attrs.alt || '') + '](' + src + (node.attrs.title ? ' ' + state.quote(node.attrs.title) : '') + ')');
};

// Hard break (Shift+Enter)
// Fixes: Backslash only when followed by actual text, not on empty/trailing lines
// - Text after → "\\\n" (line break works correctly)
// - List syntax after ("* ", "1. ") → "\n" (user typing list)
// - Block syntax after (">", "#", etc.) → "\n" (user typing blockquote/heading)
// - Multiple hard_breaks without content → "\n" (no stray backslash)
// - Trailing / no content after → "\n" (no literal "\" showing)
const hard_break = (state, node, parent, index) => {
  for (let i = index + 1; i < parent.childCount; i++) {
    const sibling = parent.child(i);
    if (sibling.type.name === 'hard_break') continue;
    if (sibling.isText) {
      if (!sibling.text.trim()) continue;
      return state.write(startsWithMarkdownSyntax(sibling.text) ? '\n' : '\\\n');
    }
    return state.write('\\\n');
  }
  state.write('\n');
};
const text = (state, node) => {
  state.text(node.text, false);
};

// Simple mark wrappers for table cell serialization.
// Avoids calling mark open/close functions which expect specific parent/index args.
const MARK_WRAPPERS = {
  strong: ['**', '**'],
  em: ['*', '*'],
  code: ['`', '`'],
  strike: ['~~', '~~'],
  superscript: ['^', '^'],
  link: null // handled specially
};

// Serialize cell inline content to a markdown string (preserves marks)
function serializeCellContent(state, cell) {
  const parts = [];
  cell.forEach(block => {
    if (block.type.name === 'paragraph') {
      block.forEach(child => {
        let t = child.text || '';
        if (child.marks) {
          child.marks.forEach(mark => {
            const wrapper = MARK_WRAPPERS[mark.type.name];
            if (wrapper) {
              t = wrapper[0] + t + wrapper[1];
            } else if (mark.type.name === 'link' && mark.attrs.href) {
              t = '[' + t + '](' + mark.attrs.href + ')';
            }
          });
        }
        parts.push(t);
      });
    }
  });
  return parts.join('');
}

// Table node → markdown table with aligned columns
const table = (state, node) => {
  const rows = [];
  node.forEach(row => rows.push(row));
  if (rows.length === 0) return;
  const colCount = rows[0].childCount;

  // Calculate column widths for alignment
  const colWidths = new Array(colCount).fill(3);
  rows.forEach(row => {
    for (let c = 0; c < row.childCount; c++) {
      const text = serializeCellContent(state, row.child(c));
      colWidths[c] = Math.max(colWidths[c], text.length);
    }
  });
  const renderRow = row => {
    const cells = [];
    for (let c = 0; c < row.childCount; c++) {
      const text = serializeCellContent(state, row.child(c));
      cells.push(' ' + text.padEnd(colWidths[c]) + ' ');
    }
    state.write('|' + cells.join('|') + '|\n');
  };

  // First row
  renderRow(rows[0]);

  // Separator after header
  const isHeader = rows[0].childCount > 0 && rows[0].child(0).type.name === 'table_header';
  if (isHeader) {
    const sep = colWidths.map(w => ' ' + '-'.repeat(w) + ' ');
    state.write('|' + sep.join('|') + '|\n');
  }

  // Remaining rows
  for (let i = 1; i < rows.length; i++) {
    renderRow(rows[i]);
  }
  state.closeBlock(node);
};

// These are handled by the table serializer above, but prosemirror-markdown
// requires every node type to have an entry
const table_row = () => {};
const table_cell = () => {};
const table_header = () => {};
const em = {
  open: '*',
  close: '*',
  mixable: true,
  expelEnclosingWhitespace: true
};
const superscript = {
  open: '^',
  close: '^',
  mixable: false,
  escape: false,
  expelEnclosingWhitespace: false
};
const strike = {
  open: '~~',
  close: '~~',
  mixable: true,
  expelEnclosingWhitespace: true
};
const strong = {
  open: '**',
  close: '**',
  mixable: true,
  expelEnclosingWhitespace: true
};
const link = {
  open(_state, mark, parent, index) {
    return isPlainURL(mark, parent, index, 1) ? '<' : '[';
  },
  close(state, mark, parent, index) {
    return isPlainURL(mark, parent, index, -1) ? '>' : '](' + state.esc(mark.attrs.href) + (mark.attrs.title ? ' ' + state.quote(mark.attrs.title) : '') + ')';
  },
  escape: false
};
const code = {
  open(_state, _mark, parent, index) {
    return backticksFor(parent.child(index), -1);
  },
  close(_state, _mark, parent, index) {
    return backticksFor(parent.child(index - 1), 1);
  },
  escape: false
};
function backticksFor(node, side) {
  let ticks = /`+/g,
    m,
    len = 0;
  if (node.isText) while (m = ticks.exec(node.text)) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}
function isPlainURL(link, parent, index, side) {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href)) return false;
  let content = parent.child(index + (side < 0 ? -1 : 0));
  if (!content.isText || content.text != link.attrs.href || content.marks[content.marks.length - 1] != link) return false;
  if (index == (side < 0 ? 1 : parent.childCount - 1)) return true;
  let next = parent.child(index + (side < 0 ? -2 : 1));
  return !link.isInSet(next.marks);
}

const ArticleMarkdownSerializer = new MarkdownSerializer({
  blockquote,
  code_block,
  heading,
  horizontal_rule,
  bullet_list,
  ordered_list,
  list_item,
  paragraph,
  image,
  hard_break,
  text,
  table,
  table_row,
  table_cell,
  table_header
}, {
  em,
  superscript,
  strike,
  strong,
  link,
  code
});

const MessageMarkdownSerializer = new MarkdownSerializer({
  mention,
  blockquote,
  code_block,
  bullet_list,
  ordered_list,
  list_item,
  paragraph,
  image,
  hard_break,
  text,
  tools
}, {
  em,
  strike,
  strong,
  link,
  code
});

const tableNodeSpecs = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+'
});

// Wrap table in a scrollable div for horizontal overflow
tableNodeSpecs.table.toDOM = () => ['div', {
  class: 'tableWrapper'
}, ['table', ['tbody', 0]]];
tableNodeSpecs.table.parseDOM = [{
  tag: 'div.tableWrapper table'
}, {
  tag: 'table'
}];
const fullSchema = new Schema({
  nodes: {
    doc: schema.spec.nodes.get('doc'),
    paragraph: schema.spec.nodes.get('paragraph'),
    blockquote: schema.spec.nodes.get('blockquote'),
    horizontal_rule: schema.spec.nodes.get('horizontal_rule'),
    heading: schema.spec.nodes.get('heading'),
    code_block: schema.spec.nodes.get('code_block'),
    text: schema.spec.nodes.get('text'),
    image: schema.spec.nodes.get('image'),
    hard_break: schema.spec.nodes.get('hard_break'),
    ordered_list: Object.assign(orderedList, {
      content: 'list_item+',
      group: 'block'
    }),
    bullet_list: Object.assign(bulletList, {
      content: 'list_item+',
      group: 'block'
    }),
    list_item: Object.assign(listItem, {
      content: 'paragraph block*'
    }),
    ...tableNodeSpecs
  },
  marks: {
    link: schema.spec.marks.get('link'),
    em: schema.spec.marks.get('em'),
    superscript: {
      parseDOM: [{
        tag: 'sup'
      }],
      toDOM() {
        return ['sup'];
      }
    },
    strong: schema.spec.marks.get('strong'),
    code: schema.spec.marks.get('code'),
    strike: {
      parseDOM: [{
        tag: 's'
      }, {
        tag: 'del'
      }, {
        tag: 'strike'
      }, {
        style: 'text-decoration',
        getAttrs: value => value === 'line-through'
      }],
      toDOM: () => ['s', 0]
    }
  }
});

const messageSchema = new Schema({
  nodes: {
    doc: schema.spec.nodes.get('doc'),
    paragraph: schema.spec.nodes.get('paragraph'),
    blockquote: schema.spec.nodes.get('blockquote'),
    code_block: schema.spec.nodes.get('code_block'),
    text: schema.spec.nodes.get('text'),
    hard_break: schema.spec.nodes.get('hard_break'),
    image: {
      ...schema.spec.nodes.get('image'),
      attrs: {
        ...schema.spec.nodes.get('image').attrs,
        height: {
          default: null
        }
      },
      parseDOM: [{
        tag: 'img[src]',
        getAttrs: dom => ({
          src: dom.getAttribute('src'),
          title: dom.getAttribute('title'),
          alt: dom.getAttribute('alt'),
          height: parseInt(dom.style.height)
        })
      }],
      toDOM: node => {
        const attrs = {
          src: node.attrs.src,
          alt: node.attrs.alt,
          height: node.attrs.height
        };
        if (node.attrs.height) {
          attrs.style = `height: ${node.attrs.height}`;
        }
        return ["img", attrs];
      }
    },
    ordered_list: Object.assign(orderedList, {
      content: 'list_item+',
      group: 'block'
    }),
    bullet_list: Object.assign(bulletList, {
      content: 'list_item+',
      group: 'block'
    }),
    list_item: Object.assign(listItem, {
      content: 'paragraph block*'
    }),
    mention: {
      attrs: {
        userFullName: {
          default: ''
        },
        userId: {
          default: ''
        },
        mentionType: {
          default: 'user'
        }
      },
      group: 'inline',
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: node => ['span', {
        class: 'prosemirror-mention-node',
        'mention-user-id': node.attrs.userId,
        'mention-user-full-name': node.attrs.userFullName,
        'mention-type': node.attrs.mentionType
      }, `@${node.attrs.userFullName}`],
      parseDOM: [{
        tag: 'span[mention-user-id][mention-user-full-name]',
        getAttrs: dom => {
          const userId = dom.getAttribute('mention-user-id');
          const userFullName = dom.getAttribute('mention-user-full-name');
          const mentionType = dom.getAttribute('mention-type') || 'user';
          return {
            userId,
            userFullName,
            mentionType
          };
        }
      }]
    },
    tools: {
      attrs: {
        id: {
          default: ''
        },
        name: {
          default: ''
        }
      },
      group: 'inline',
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: node => ['span', {
        class: 'prosemirror-tools-node',
        'tool-id': node.attrs.id,
        'tool-name': node.attrs.name
      }, `@${node.attrs.name}`],
      parseDOM: [{
        tag: 'span[tool-id][tool-name]',
        getAttrs: dom => {
          const id = dom.getAttribute('tool-id');
          const name = dom.getAttribute('tool-name');
          return {
            id,
            name
          };
        }
      }]
    }
  },
  marks: {
    link: schema.spec.marks.get('link'),
    em: schema.spec.marks.get('em'),
    strong: schema.spec.marks.get('strong'),
    code: schema.spec.marks.get('code'),
    strike: {
      parseDOM: [{
        tag: 's'
      }, {
        tag: 'del'
      }, {
        tag: 'strike'
      }, {
        style: 'text-decoration',
        getAttrs: value => value === 'line-through'
      }],
      toDOM: () => ['s', 0]
    }
  }
});

/**
 * Build a schema with only specified marks and nodes enabled
 * This controls keyboard shortcuts, paste, input rules, and menu
 * 
 * @param {Array<string>} enabledMarks - Array of mark names to allow
 * @param {Array<string>} enabledNodes - Array of node names to allow (e.g., ['bulletList', 'orderedList'])
 * @returns {Schema}
 */
function buildMessageSchema(enabledMarks = ['strong', 'em', 'code', 'link'], enabledNodes = ['bulletList', 'orderedList']) {
  // Build marks string for nodes (space-separated mark names)
  const marksString = enabledMarks.length > 0 ? enabledMarks.join(' ') : '';

  // Check which nodes are enabled
  const hasBulletList = enabledNodes.includes('bulletList');
  const hasOrderedList = enabledNodes.includes('orderedList');
  const hasCodeBlock = enabledNodes.includes('codeBlock');
  const hasBlockquote = enabledNodes.includes('blockquote');
  const hasImage = enabledNodes.includes('image');

  // Define nodes - copy from messageSchema but with restricted marks
  const nodes = {
    doc: schema.spec.nodes.get('doc'),
    paragraph: {
      ...schema.spec.nodes.get('paragraph'),
      marks: marksString
    },
    // Only add blockquote if enabled
    ...(hasBlockquote ? {
      blockquote: {
        ...schema.spec.nodes.get('blockquote'),
        marks: marksString
      }
    } : {}),
    // Only add code_block if enabled
    ...(hasCodeBlock ? {
      code_block: schema.spec.nodes.get('code_block')
    } : {}),
    text: schema.spec.nodes.get('text'),
    hard_break: schema.spec.nodes.get('hard_break'),
    // Only add image if enabled
    ...(hasImage ? {
      image: {
        ...schema.spec.nodes.get('image'),
        attrs: {
          ...schema.spec.nodes.get('image').attrs,
          height: {
            default: null
          }
        },
        parseDOM: [{
          tag: 'img[src]',
          getAttrs: dom => ({
            src: dom.getAttribute('src'),
            title: dom.getAttribute('title'),
            alt: dom.getAttribute('alt'),
            height: parseInt(dom.style.height)
          })
        }],
        toDOM: node => {
          const attrs = {
            src: node.attrs.src,
            alt: node.attrs.alt,
            height: node.attrs.height
          };
          if (node.attrs.height) {
            attrs.style = `height: ${node.attrs.height}`;
          }
          return ["img", attrs];
        }
      }
    } : {}),
    // Only add list nodes if enabled
    ...(hasOrderedList ? {
      ordered_list: Object.assign({}, orderedList, {
        content: 'list_item+',
        group: 'block'
      })
    } : {}),
    ...(hasBulletList ? {
      bullet_list: Object.assign({}, bulletList, {
        content: 'list_item+',
        group: 'block'
      })
    } : {}),
    // Only add list_item if at least one list type is enabled
    ...(hasBulletList || hasOrderedList ? {
      list_item: Object.assign({}, listItem, {
        content: 'paragraph block*',
        marks: marksString
      })
    } : {}),
    mention: {
      attrs: {
        userFullName: {
          default: ''
        },
        userId: {
          default: ''
        },
        mentionType: {
          default: 'user'
        }
      },
      group: 'inline',
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: node => ['span', {
        class: 'prosemirror-mention-node',
        'mention-user-id': node.attrs.userId,
        'mention-user-full-name': node.attrs.userFullName,
        'mention-type': node.attrs.mentionType
      }, `@${node.attrs.userFullName}`],
      parseDOM: [{
        tag: 'span[mention-user-id][mention-user-full-name]',
        getAttrs: dom => {
          const userId = dom.getAttribute('mention-user-id');
          const userFullName = dom.getAttribute('mention-user-full-name');
          const mentionType = dom.getAttribute('mention-type') || 'user';
          return {
            userId,
            userFullName,
            mentionType
          };
        }
      }]
    },
    tools: {
      attrs: {
        id: {
          default: ''
        },
        name: {
          default: ''
        }
      },
      group: 'inline',
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: node => ['span', {
        class: 'prosemirror-tools-node',
        'tool-id': node.attrs.id,
        'tool-name': node.attrs.name
      }, `@${node.attrs.name}`],
      parseDOM: [{
        tag: 'span[tool-id][tool-name]',
        getAttrs: dom => {
          const id = dom.getAttribute('tool-id');
          const name = dom.getAttribute('tool-name');
          return {
            id,
            name
          };
        }
      }]
    }
  };

  // Build marks object - ONLY include enabled marks
  const marks = {};
  if (enabledMarks.includes('link')) {
    marks.link = schema.spec.marks.get('link');
  }
  if (enabledMarks.includes('em')) {
    marks.em = schema.spec.marks.get('em');
  }
  if (enabledMarks.includes('strong')) {
    marks.strong = schema.spec.marks.get('strong');
  }
  if (enabledMarks.includes('code')) {
    marks.code = schema.spec.marks.get('code');
  }
  if (enabledMarks.includes('strike')) {
    marks.strike = {
      parseDOM: [{
        tag: 's'
      }, {
        tag: 'del'
      }, {
        tag: 'strike'
      }, {
        style: 'text-decoration',
        getAttrs: value => value === 'line-through'
      }],
      toDOM: () => ['s', 0]
    };
  }
  return new Schema({
    nodes,
    marks
  });
}

const buildEditor = ({
  schema,
  placeholder,
  methods: {
    onImageUpload,
    onCopilotClick
  } = {},
  plugins = [],
  enabledMenuOptions
}) => [...(plugins || []), history(), baseKeyMaps(schema), blocksInputRule(schema), textFormattingInputRules(schema), linksInputRules(schema), autoLinkURLs(schema), hrInputRules(schema), listInputRules(schema), dropCursor(), gapCursor(), schema.nodes.table ? tableEditing() : null, schema.nodes.table ? tableControlsPlugin(schema) : null, Placeholder(placeholder), menuBar({
  floating: true,
  content: buildMenuOptions(schema, {
    enabledMenuOptions,
    onImageUpload,
    onCopilotClick
  })
}), new Plugin({
  props: {
    attributes: {
      class: "ProseMirror-woot-style"
    }
  }
})].filter(Boolean);

export { ArticleMarkdownSerializer, ArticleMarkdownTransformer, MessageMarkdownSerializer, MessageMarkdownTransformer, buildEditor, buildMessageSchema, fullSchema, messageSchema };
//# sourceMappingURL=index.es.js.map
