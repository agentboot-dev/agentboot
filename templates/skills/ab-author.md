# /ab author

Authoring skill — create and edit personas, traits, instructions, and gotchas.

## Usage

```
/ab author persona <name>       — Create a new persona scaffold
/ab author trait <name>         — Create a new trait file
/ab author instruction <name>   — Create a new instruction file
/ab author gotcha <name>        — Create a new gotcha rule
/ab author lexicon <term>       — Add a lexicon entry
```

## Persona Authoring

When creating a persona, this skill generates:
- `core/personas/<name>/SKILL.md` with trait injection markers
- `core/personas/<name>/persona.config.json` with default trait weights

## Trait Authoring

Traits are reusable behavioral building blocks. Each trait file lives in
`core/traits/` and follows the standard markdown format with frontmatter.

## Notes

- All authoring operations create files locally. Run `/ab build` to compile.
- Use `/ab validate` to check authored content for errors before building.
