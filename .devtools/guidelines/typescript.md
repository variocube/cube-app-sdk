# TypeScript Guidelines

## Formatting

* Use **dprint** for formatting TypeScript, JavaScript, JSON, and Markdown.
* Configuration is provided by devtools (`dprint.json`).
* Install dprint if needed: `npm install --save-dev dprint`

## Strict Mode
* Enable strict mode in `tsconfig.json`.
* Never use `any` unless absolutely necessary; prefer `unknown` for truly unknown types.

## Types vs Interfaces
* Use `interface` for object shapes (props, API responses, context).
* Use `type` for unions, intersections, and primitive aliases.

```typescript
// Interface for object shapes
interface UserProps {
  name: string;
  email: string;
}

// Type for unions
type Status = "pending" | "active" | "inactive";
```

## Generics
* Use generics for reusable hooks and utility functions.
* Provide meaningful type parameter names (`T`, `TResult`, `TError`).

## Readonly
* Use `Readonly<T>` for props that should not be mutated.
* Use `readonly` modifier for class/interface properties that shouldn't change.

## Null Handling
* Prefer `undefined` over `null` for optional values.
* Use optional chaining (`?.`) and nullish coalescing (`??`).
* Avoid non-null assertions (`!`) unless the value is guaranteed.

## Imports
* Never use wildcard imports.
* Group imports: external libraries first, then internal modules.
* Use destructuring for multiple imports from the same module.

## Schema Validation
* Use Zod for runtime validation of API responses and external data.
* Extract types from Zod schemas with `TypeOf` or `z.infer`.

## Naming Conventions
* PascalCase for types, interfaces, and classes.
* camelCase for variables, functions, and properties.
* UPPER_SNAKE_CASE for true constants.
