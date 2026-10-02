---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable.
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface.

## Glossary

- **Module** — anything with an interface and an implementation
- **Interface** — everything a caller must know to use the module correctly
- **Depth** — leverage at the interface: behaviour per unit of interface
- **Seam** — a place where you can alter behaviour without editing in that place
- **Adapter** — a concrete thing that satisfies an interface at a seam
- **Leverage** — what callers get from depth
- **Locality** — what maintainers get from depth

## Principles

- Depth is a property of the interface, not the implementation
- The deletion test: if complexity vanishes when you delete the module, it was a pass-through
- The interface is the test surface
- One adapter means a hypothetical seam. Two adapters means a real one
