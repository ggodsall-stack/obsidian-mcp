# Quarto setup on macOS Apple Silicon

Verified: 11 November 2026.

## Scope

This records the completed Quarto upgrade, shell and Pandoc fixes, TinyTeX installation, and standalone rendering checks. It is a machine-level setup record, not configuration for this repository or a particular Quarto project.

## Verified environment

| Component | Version / location |
| --- | --- |
| Quarto | 1.11.9 |
| Quarto installation | `/Applications/quarto` |
| Quarto executable | `/usr/local/bin/quarto`, linked to `/Applications/quarto/bin/quarto` |
| Bundled Pandoc | 3.10; `/Applications/quarto/bin/tools/pandoc` |
| R | 4.5.1; `/Library/Frameworks/R.framework/Resources` |
| Rscript | `/usr/local/bin/Rscript` |
| knitr | 1.50 |
| rmarkdown | 2.29 |
| Python | 3.13.5; `/opt/anaconda3/bin/python` |
| Jupyter Core | 5.7.2 |
| ipykernel | 6.29.5; `python3` kernel available |
| TinyTeX | v2026.11 / TeX Live 2026 |
| LaTeX binaries | `/Users/GuyG/Library/TinyTeX/bin/universal-darwin` |
| Typst | 0.15.1 |
| Deno | 2.9.8 |
| Dart Sass | 1.101.0 |
| Chrome | Detected at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |

Versions above are a verification snapshot, not version pins.

## 1. Upgrade Quarto

The following command upgraded Quarto from 1.9.37 to 1.11.9:

```sh
brew upgrade --cask quarto
```

The installer requested administrator authentication and completed successfully. Although Homebrew manages the cask, its executable is linked under `/usr/local/bin`, not `/opt/homebrew/bin`.

For a new installation where the cask is not already installed, use `brew install --cask quarto` instead.

## 2. Fix the shell aliases and Pandoc search path

Two issues were found:

1. The existing Quarto alias targeted the nonexistent `/opt/homebrew/bin/quarto`.
2. R found `/opt/anaconda3/bin/pandoc` through `PATH`. That binary failed with `Bad CPU type in executable`. The existing interactive Pandoc alias did not affect R subprocesses.

The following block now appears in `/Users/GuyG/.zshrc`:

```sh
# Prefer Quarto's native bundled tools over Anaconda's incompatible pandoc.
export PATH="/Applications/quarto/bin/tools:$PATH"
alias pandoc="/Applications/quarto/bin/tools/pandoc"
alias quarto="/usr/local/bin/quarto"
```

To reproduce the change, replace the old alias block rather than repeatedly appending this block. Keep it after Conda's initialization block so that the bundled Pandoc takes precedence.

The bundled Pandoc is native and was verified to run successfully. Homebrew's separate Pandoc 3.13 was also present and runnable, but is not the selected executable in this configuration.

The fixes were applied to the active shell and verified in a new login shell. For other existing terminal sessions, open a new shell or reload the configuration:

```sh
source ~/.zshrc
```

Anaconda's Python remains selected. No Anaconda binaries were removed or replaced, and no R startup files were changed.

## 3. Install a LaTeX distribution

Installed Quarto-managed TinyTeX:

```sh
quarto install tinytex --no-prompt
```

Installation downloaded TinyTeX v2026.11, configured font paths, and selected `https://tlnet.yihui.org` as its package repository.

TinyTeX is installed at `/Users/GuyG/Library/TinyTeX`. Quarto detects its binaries directly; no additional LaTeX `PATH` entry was needed for the tested Quarto PDF workflow.

## 4. Verify the configuration

Check shell syntax:

```sh
zsh -n ~/.zshrc
```

Check persistent configuration in a fresh login shell:

```sh
zsh -lic 'whence -v quarto pandoc; quarto --version; quarto list tools; quarto check'
```

Expected alias targets:

```text
quarto is an alias for /usr/local/bin/quarto
pandoc is an alias for /Applications/quarto/bin/tools/pandoc
```

Check the Pandoc selected by R:

```sh
Rscript -e 'cat("PATH pandoc:", Sys.which("pandoc"), "\n"); print(rmarkdown::find_pandoc(cache = FALSE))'
```

At verification, R selected `/Applications/quarto/bin/tools/pandoc`, version 3.10.

### Completed checks

- Shell configuration syntax: passed.
- Fresh-shell aliases and executable resolution: passed.
- Quarto installation and bundled dependencies: passed.
- Basic Markdown rendering: passed.
- R installation and Knitr engine rendering: passed.
- Anaconda Python and Jupyter engine rendering: passed.
- TinyTeX detection: passed.
- System Chrome detection: passed.
- Standalone LuaLaTeX PDF rendering with text and mathematics: passed.

The PDF test produced a nonempty 11,748-byte file with a valid `%PDF-` header. It was a smoke test, not a visual or PDF-conformance audit.

## 5. Render a document

For an existing Quarto document:

```sh
quarto render document.qmd --to pdf
```

To create a minimal manual test, save the following as `pdf-test.qmd` in a scratch directory:

```yaml
---
title: "Quarto PDF verification"
format: pdf
---

TinyTeX PDF rendering is working.

Math check: $E = mc^2$.
```

Then run:

```sh
quarto render pdf-test.qmd --to pdf
```

The successful verification used LuaLaTeX. The first render generated the font database; first-run font initialization can take longer than subsequent renders.

## Troubleshooting and boundaries

### Quarto still resolves to the old path

Open a new terminal session, then check:

```sh
whence -v quarto
/usr/local/bin/quarto --version
```

If the absolute executable works but the alias is wrong, inspect the relevant shell startup files for another alias definition.

### R reports an incompatible Pandoc again

Check R's executable selection using the command in section 4. Shell aliases do not control `Sys.which("pandoc")`; the bundled tools directory must precede Anaconda on the inherited `PATH`.

Activating another Conda environment may change path ordering. Recheck executable selection after environment changes.

### A GUI app uses different executables

Applications launched outside an interactive shell may not read `.zshrc`. Restart the application and inspect its own Quarto/Pandoc settings if it does not reproduce the terminal results. GUI application integration was not verified.

### Optional components

- VeraPDF is not installed. It is optional for PDF conformance validation, not required for the tested PDF render.
- Dedicated Chrome Headless Shell is not installed. Quarto detected the existing Google Chrome installation.
- Julia workflows were not validated.
- Custom templates, bibliography workflows, specialist fonts, project-specific R/Python dependencies, and combined code-to-PDF workflows were not tested. R and Jupyter render checks passed independently; the PDF smoke test used text and mathematics.
- Additional LaTeX packages may require downloads when rendering more complex documents.

## Maintenance

Check Quarto upgrades and rerun diagnostics after significant changes:

```sh
brew upgrade --cask quarto
quarto --version
quarto list tools
quarto check
```

These setup fixes do not require deleting Anaconda, reinstalling R, or replacing system executables.
