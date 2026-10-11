/**
 * LDAM Boolean Engine — Expression Parser
 * Parses Boolean expressions with support for:
 * - Single-letter variables (A–Z)
 * - Prefix NOT (!, ~, NOT) and Postfix NOT (')
 * - AND (*, &, ., AND, and implicit juxtaposition AB)
 * - OR (+, |, OR)
 * - XOR (^, XOR)
 * - XNOR (~^, @, XNOR)
 * - Constants 0 and 1
 * - Parentheses
 * Precedence: NOT > AND > XOR/XNOR > OR
 */

import type { Expr } from '../types';

export class ParseError extends Error {
  position: number;

  constructor(message: string, position: number) {
    super(`Parse error at position ${position}: ${message}`);
    this.name = 'ParseError';
    this.position = position;
  }
}

type TokenType =
  | 'VAR'
  | 'CONST'
  | 'PREFIX_NOT'
  | 'POSTFIX_NOT'
  | 'AND'
  | 'OR'
  | 'XOR'
  | 'XNOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function canEndExpr(type: TokenType): boolean {
  return type === 'VAR' || type === 'CONST' || type === 'RPAREN' || type === 'POSTFIX_NOT';
}

function canStartExpr(type: TokenType): boolean {
  return type === 'VAR' || type === 'CONST' || type === 'LPAREN' || type === 'PREFIX_NOT';
}

/**
 * Tokenizes the input string into a list of tokens, inserting implicit AND tokens
 * where juxtaposition occurs.
 */
function tokenize(input: string): Token[] {
  const rawTokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    const startPos = i;

    // Check for keywords first (case-insensitive)
    const remaining = input.slice(i);
    const keywordMatch = remaining.match(/^(XNOR|XOR|AND|NOT|OR)\b/i);
    if (keywordMatch) {
      const kw = keywordMatch[1].toUpperCase();
      let type: TokenType = 'AND';
      if (kw === 'NOT') type = 'PREFIX_NOT';
      else if (kw === 'AND') type = 'AND';
      else if (kw === 'OR') type = 'OR';
      else if (kw === 'XOR') type = 'XOR';
      else if (kw === 'XNOR') type = 'XNOR';

      rawTokens.push({ type, value: kw, pos: startPos });
      i += kw.length;
      continue;
    }

    // Check for ~^ (XNOR)
    if (input.slice(i, i + 2) === '~^') {
      rawTokens.push({ type: 'XNOR', value: '~^', pos: startPos });
      i += 2;
      continue;
    }

    // Single-character tokens
    if (ch === "'") {
      rawTokens.push({ type: 'POSTFIX_NOT', value: "'", pos: startPos });
      i++;
    } else if (ch === '!' || ch === '~') {
      rawTokens.push({ type: 'PREFIX_NOT', value: ch, pos: startPos });
      i++;
    } else if (ch === '+' || ch === '|') {
      rawTokens.push({ type: 'OR', value: ch, pos: startPos });
      i++;
    } else if (ch === '*' || ch === '&' || ch === '.') {
      rawTokens.push({ type: 'AND', value: ch, pos: startPos });
      i++;
    } else if (ch === '^') {
      rawTokens.push({ type: 'XOR', value: ch, pos: startPos });
      i++;
    } else if (ch === '@') {
      rawTokens.push({ type: 'XNOR', value: ch, pos: startPos });
      i++;
    } else if (ch === '(') {
      rawTokens.push({ type: 'LPAREN', value: ch, pos: startPos });
      i++;
    } else if (ch === ')') {
      rawTokens.push({ type: 'RPAREN', value: ch, pos: startPos });
      i++;
    } else if (ch === '0' || ch === '1') {
      rawTokens.push({ type: 'CONST', value: ch, pos: startPos });
      i++;
    } else if (/[a-zA-Z]/.test(ch)) {
      rawTokens.push({ type: 'VAR', value: ch.toUpperCase(), pos: startPos });
      i++;
    } else {
      throw new ParseError(`Unexpected character '${ch}'`, startPos);
    }
  }

  // Insert implicit AND for juxtaposition
  const tokens: Token[] = [];
  for (let idx = 0; idx < rawTokens.length; idx++) {
    const cur = rawTokens[idx];
    tokens.push(cur);

    if (idx + 1 < rawTokens.length) {
      const next = rawTokens[idx + 1];
      if (canEndExpr(cur.type) && canStartExpr(next.type)) {
        tokens.push({ type: 'AND', value: '*', pos: next.pos });
      }
    }
  }

  tokens.push({ type: 'EOF', value: '', pos: input.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) this.current++;
    return token;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === 'EOF';
    return this.peek().type === type;
  }

  parse(): Expr {
    if (this.isAtEnd()) {
      throw new ParseError('Empty expression', 0);
    }
    const expr = this.parseOr();
    if (!this.isAtEnd()) {
      const unexpected = this.peek();
      throw new ParseError(`Unexpected token '${unexpected.value}'`, unexpected.pos);
    }
    return expr;
  }

  // OR: lowest binary precedence
  private parseOr(): Expr {
    let expr = this.parseXor();

    const orArgs: Expr[] = [expr];
    while (this.match('OR')) {
      const right = this.parseXor();
      orArgs.push(right);
    }

    if (orArgs.length > 1) {
      return { t: 'or', args: orArgs };
    }
    return expr;
  }

  // XOR and XNOR: precedence between OR and AND
  private parseXor(): Expr {
    let expr = this.parseAnd();

    while (this.check('XOR') || this.check('XNOR')) {
      const op = this.advance();
      const right = this.parseAnd();
      if (op.type === 'XOR') {
        expr = { t: 'xor', args: [expr, right] };
      } else {
        expr = { t: 'xnor', args: [expr, right] };
      }
    }

    return expr;
  }

  // AND: precedence above XOR/XNOR
  private parseAnd(): Expr {
    let expr = this.parseUnary();

    const andArgs: Expr[] = [expr];
    while (this.match('AND')) {
      const right = this.parseUnary();
      andArgs.push(right);
    }

    if (andArgs.length > 1) {
      return { t: 'and', args: andArgs };
    }
    return expr;
  }

  // Prefix NOT: !, ~, NOT
  private parseUnary(): Expr {
    if (this.match('PREFIX_NOT')) {
      const sub = this.parseUnary();
      return { t: 'not', a: sub };
    }
    return this.parsePostfix();
  }

  // Postfix NOT: ' (can be chained, e.g. A'')
  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (this.match('POSTFIX_NOT')) {
      expr = { t: 'not', a: expr };
    }

    return expr;
  }

  // Primary: VAR, CONST, ( Expr )
  private parsePrimary(): Expr {
    const token = this.peek();

    if (this.match('VAR')) {
      return { t: 'var', name: token.value };
    }

    if (this.match('CONST')) {
      return { t: 'const', v: token.value === '1' ? 1 : 0 };
    }

    if (this.match('LPAREN')) {
      const inner = this.parseOr();
      if (!this.match('RPAREN')) {
        throw new ParseError("Expected closing ')'", this.peek().pos);
      }
      return inner;
    }

    throw new ParseError(
      token.type === 'EOF' ? 'Unexpected end of expression' : `Unexpected token '${token.value}'`,
      token.pos
    );
  }
}

/**
 * Parses a Boolean expression string into an Expr AST.
 * @throws {ParseError} If the expression is malformed.
 */
export function parseExpr(text: string): Expr {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new ParseError('Empty expression', 0);
  }
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  return parser.parse();
}
