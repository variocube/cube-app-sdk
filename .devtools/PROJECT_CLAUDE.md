# Project Guidelines

This project uses Variocube coding standards. Follow these guidelines:

## Guidelines

- [General Guidelines](.devtools/guidelines/general.md) - Formatting, parameter counts
- [Java Guidelines](.devtools/guidelines/java.md) - Lombok, null handling, Spotless
- [TypeScript Guidelines](.devtools/guidelines/typescript.md) - Strict mode, types, dprint
- [React Guidelines](.devtools/guidelines/react.md) - Components, hooks, state management
- [Spring Boot Guidelines](.devtools/guidelines/spring-boot.md) - Architecture, testing, configuration

## Quick Reference

### Formatting
- Tabs for indentation, 120 char line width
- Java: Spotless with Eclipse formatter (`.devtools/eclipse-formatter.xml`)
- TypeScript/JSON/Markdown: dprint (`dprint.json`)

### Architecture (Spring Boot)
- **Domain Objects**: Immutable POJOs with `@Value`, `@Builder` in `domain` package
- **JPA Entities**: Mutable, `Entity` suffix, in `out.store` package
- **Outbound Adapters**: External services in `out` package
- **Application**: Commands in root package
- **Inbound Adapters**: REST controllers in `in.web`, scheduled jobs in `in.timer`

### Code Style
- Prefer parameter objects over many parameters (≤3 recommended)
- Use `Optional` for methods that might not return a value
- Never use wildcard imports
- Use Zod for runtime validation in TypeScript
