---
title: "MIX — A Programming Language Built with AI, From Zero Compiler Experience"
description: "A programming language and compiler built as an experiment in AI-assisted software development. Features indentation-sensitive syntax, generics, concurrency, C interop, LLVM and C backends, and a built-in LSP."
tech: ["C", "LLVM", "QBE"]
weight: 5
---

## What Is It?

MIX is a systems programming language I built with zero prior compiler experience, using AI as a pair-programming partner. Think Python's readability and Odin's explicitness, translated into a language that compiles to native code — no VM, no GC, no runtime overhead.

The language itself has about 30 keywords, indentation-sensitive syntax (like Python), generics with monomorphization, concurrency primitives (`go`/`wait`/`shared`), region-based memory management via zones, and first-class C interop that can auto-generate bindings from any C header at compile time. The compiler has two backends (LLVM and C), a built-in LSP server, a code formatter, a C binding generator, and a build system. It compiles itself in under a second. What makes it unusual is the story of how it was built — not by a compiler engineer, but by someone who learned the entire pipeline through directed construction with AI.

## Why Did I Build It?

I wanted to understand compilers the way a mechanic understands an engine — by taking one apart and putting it back together. I'd read the dragon book chapters, worked through tutorials, and still felt like language implementation was magic. The AI angle wasn't planned; it turned into the project's defining characteristic. I realized that with a sufficiently capable AI assistant, I could skip the months of study and go straight to building — making all the mistakes, asking why every time something broke, and arriving at real understanding through debugging, not reading. MIX became the artifact of that process.

## What Did I Learn?

**Compilers aren't magic, but the gap between "a parser that works" and "a compiler people can use" is enormous.** Getting the lexer and parser running took maybe two days with AI assistance. The recursive descent parser with Pratt expression parsing is about 300 lines of C. What took the remaining weeks was everything else: error messages that point to the right source location, type inference that doesn't give up on the first mismatch, monomorphization that handles generics without code explosion, a lowering pass that makes control flow explicit so both backends share one semantic model, and an LSP that doesn't crash on malformed input. The parser is the easy part.

**Monomorphization seemed simple until I hit the ABI wall.** My first attempt at generics cloned the function body for each concrete type and compiled each copy independently. It worked for integers. For floats, the generated code silently corrupted values because the QBE backend expected floats in a different register class than integers. Tracing through the emitted IR to find the mismatch — a wrong type suffix on a load instruction — took three evenings. I fixed it by adding a type-classification pass that tags every function parameter with its ABI class before emission. The lesson: generics in a systems language are easy to implement badly. Getting them right means understanding your backend's calling convention, not just the type system.

**The C header parser (cbind) was the hardest single module to get right.** It's about 2,000 lines of C that runs the system preprocessor, parses the expanded output, strips qualifiers, maps C types to MIX types, and generates valid MIX source. The challenge is that C headers are wildly inconsistent — macros that look like functions, `#define` constants with arithmetic expressions, structs with platform-conditional fields, anonymous unions, nested `#ifdef` forests. The first version crashed on SDL3's headers (too many edge cases). The second version produced wrong type mappings for `uint64_t`. The third version — the one that works — handles about 95% of real-world headers. The remaining 5% requires manual extern declarations, which the language supports as a fallback.

**AI is excellent at generating working code from clear specifications, but terrible at fixing subtle correctness bugs.** The lexer, parser, sema, and both backends were all initially AI-generated based on my descriptions. They worked on the first try more often than I expected. But when generics produced wrong float values, or the LSP returned stale completions after a file edit, AI could suggest hypotheses but couldn't systematically debug the way a human can by reading the generated code and tracing execution. The bottleneck became my ability to understand the generated output well enough to identify what was wrong — which, over time, was exactly the learning I wanted.

**Error message quality is the best productivity investment in a compiler.** Every hour I spent on source locations, colored terminal output, and descriptive error messages saved three hours of debugging. The compiler tracks source positions through every stage — lexer tokens carry line/column, AST nodes carry their source range, and even the generated LLVM IR includes DWARF metadata so lldb can map back to MIX source lines. The investment paid off most during the early days when half my programs failed to compile; bad error messages would have made me abandon the project.

## Key Results

| Metric | Value |
|---|---|
| **C header auto-bindings** | `use c "SDL3/SDL.h"` — one line generates all bindings at compile time |
| **Backends** | LLVM (primary, with DWARF debug info) + C (portability fallback) |
| **Compiler LOC** | ~7,500 C, self-compiles in < 1 second |
| **Test suite** | 140+ tests across runtime behavior, errors, and formatting |
| **Generics** | Monomorphized per concrete type with ABI-aware code generation |
| **Memory model** | Zone-based region allocation, explicit borrows and boxes, no GC |
| **Parser** | Recursive descent + Pratt expression parsing, indentation-sensitive |
| **Concurrency** | `go`/`wait`/`shared` primitives backed by pthreads |
| **Tooling** | LSP, code formatter, C binding generator, declarative build system |
| **C interop** | Two paths: manual `extern` blocks + auto-generated `use c` from headers |
| **Runtime** | ~750 C, includes optional runtime for concurrency and zone allocation |
| **Dependencies** | LLVM toolchain, standard C compiler |

## Screenshots / Media

<!-- SCREENSHOT 1: A terminal window showing a MIX program being compiled and run — source code on the left, program output on the right. Caption: "Compiling and running a MIX program — `mix run hello.mix` invokes the full pipeline: lex, parse, sema, lower, LLVM emit, assemble, link, and execute." -->
<!-- SCREENSHOT 2: Neovim with the MIX LSP active — showing hover type information, completion popup, and diagnostic underlines. Caption: "The MIX LSP in Neovim — hover type info, completion, and inline diagnostics driven by the same semantic analysis pass used during compilation." -->
<!-- SCREENSHOT 3: A side-by-side comparison of MIX source code and the generated LLVM IR, highlighting how high-level constructs map to low-level primitives. Caption: "MIX source and the LLVM IR it generates — zone allocation lowers to stack slots, generics monomorphize to concrete function bodies, and control flow becomes LLVM basic blocks." -->

## Technical Deep Dive

For the engineers wondering what it takes to build a compiler from zero — here is the full pipeline, the architecture decisions, and the parts that broke most often.

### Pipeline Architecture

```
source.mix → Lexer → Parser → Sema → Lower → LIR → LLVM Emit → .ll → clang -c → .o → link → binary
                                                          ↘ C Emit → .c → cc -c → .o ↗
```

Each stage is a single pass with no backtracking. The AST is arena-allocated and freed after lowering. The lowered IR (LIR) is the shared semantic layer between both backends — language semantics are decided once in the lowering pass, not duplicated in each backend.

### Lexer: Indentation-Sensitive Tokenizer

The lexer emits INDENT/DEDENT tokens for block structure, similar to Python's approach. It tracks indentation levels as a stack of column counts:

```c
typedef enum {
    TOK_INT_LIT, TOK_FLOAT_LIT, TOK_STR_LIT,
    TOK_IDENT, TOK_MUT_IDENT,    // x vs x!
    TOK_INDENT, TOK_DEDENT, TOK_NEWLINE,
    TOK_IF, TOK_ELSE, TOK_WHILE, TOK_FOR,
    TOK_SHAPE, TOK_UNION, TOK_MATCH,
    TOK_GO, TOK_WAIT, TOK_SHARED,
    TOK_ZONE, TOK_DEFER, TOK_USE, TOK_PUB, TOK_EXTERN,
    TOK_AT_CONST, TOK_AT_OS, TOK_AT_ARCH,
    // ~60 token types total
} TokenKind;
```

The mutable-identifier token (`x!`) is a single token — the lexer emits `TOK_MUT_IDENT` instead of `TOK_IDENT` followed by `TOK_BANG`, which simplifies the parser's grammar considerably.

### Pratt Parsing for Expressions

Expression parsing uses the Pratt algorithm, where each token has a binding power (precedence) and the parser dispatches to prefix or infix handlers based on token position:

```c
static AstNode *parse_expr_prec(Parser *p, Precedence min_prec) {
    AstNode *left = parse_prefix(p);
    while (p->cur->kind != TOK_EOF &&
           get_precedence(p->cur->kind) > min_prec) {
        left = parse_infix(p, left);
    }
    return left;
}
```

This handles operator precedence, associativity, and prefix/postfix operators in a single recursive function. The key insight is that each `parse_infix` handler knows its own binding power — addition calls `parse_expr_prec(p, PREC_ADD)` on its right operand, ensuring correct left-to-right grouping.

### Semantic Analysis and Monomorphization

The sema pass walks the AST top-down, maintaining a scoped symbol table. For generic functions, it clones the function body for each concrete type encountered at call sites:

```c
static MixType *infer_type(Sema *s, AstNode *expr) {
    switch (expr->kind) {
        case NODE_INT_LIT:   return type_int();
        case NODE_FLOAT_LIT: return type_float();
        case NODE_STR_LIT:   return type_str();
        case NODE_BINARY: {
            MixType *lt = infer_type(s, expr->binary.left);
            MixType *rt = infer_type(s, expr->binary.right);
            return unify_types(lt, rt);  // int + float → float
        }
    }
}
```

Monomorphization happens during sema, not as a separate pass. When a call to a generic function is resolved, the sema pass creates a copy of the function's AST with the concrete type substituted, registers the new function in the symbol table, and rewrites the call site to point to the monomorphized version.

### Lowering to LIR

Before code generation, the AST is lowered to LIR — an intermediate representation that makes memory operations explicit:

```c
typedef enum {
    LIR_ALLOCA,      // local variable slot
    LIR_LOAD,        // load from slot or memory
    LIR_STORE,       // store to slot or memory
    LIR_MEMCPY,      // whole-shape copy
    LIR_FIELD_ADDR,  // compute field address within a shape
    LIR_CALL,        // function call
    LIR_BRANCH,      // conditional branch
    LIR_JUMP,        // unconditional jump
    LIR_RETURN,      // function return
} LirOpKind;
```

This layer is the key architectural decision that made two backends feasible. Both LLVM and C backends consume LIR, so language semantics (how shape copies work, how closures capture variables, how `defer` is implemented) are defined once.

### The C Header Auto-Binding Engine

The `cbind` module is the most technically ambitious part of MIX. When the compiler encounters:

```rust
use c "SDL3/SDL.h" link "SDL3"
```

It runs the C preprocessor on the header (`cc -E`), parses the preprocessed output (function prototypes, struct definitions, typedefs, `#define` constants), maps C types to MIX types, strips C qualifiers, resolves naming conflicts (e.g., `type` → `type_` to avoid the MIX keyword), and generates MIX source that passes through the normal compiler pipeline — all in a single `mix run` command.

The type mapping table:

```
C type        → MIX type
int           → int32
long          → int64
float         → float32
double        → float
char*         → *byte
void*         → *byte
struct T      → shape T (with field names preserved)
union T       → union T (all members at offset 0)
```

The system preprocessor step is unavoidable — you need macros expanded and includes resolved before you can parse the C types. But it means the compiler requires `cc` on the PATH, which limits cross-compilation scenarios. A future improvement would bundle a minimal preprocessor.

### The AI Development Workflow

The project's defining process was a tight loop: I described a language feature, AI generated the implementation, I reviewed and tested, and we debugged together. The workflow worked best when I gave precise specifications:

> "I want MIX to have generic functions with type parameters using `@T` syntax. The implementation should monomorphize — clone the function body per concrete type. Start with the sema pass: when a call to `@T` function is resolved to `int`, create a copy of the function AST with `T` replaced by `int`, register the new function, and update the call site."

AI was good at turning this into working code. It was bad at anticipating edge cases — unused generic parameters, recursive generics, generic functions passed as function pointers. Those were discovered through the test suite, which grew to 140+ programs covering every feature.
