# Java Guidelines

## Formatting

Use **Spotless** with the Eclipse formatter for consistent code style. Configuration is provided by devtools (`eclipse-formatter.xml`).

### Gradle

```kotlin
plugins {
    id("com.diffplug.spotless") version "7.0.2"
}

spotless {
    java {
        eclipse().configFile(".devtools/eclipse-formatter.xml")
    }
}
```

Run with: `./gradlew spotlessApply`

### Maven

```xml
<plugin>
    <groupId>com.diffplug.spotless</groupId>
    <artifactId>spotless-maven-plugin</artifactId>
    <version>2.44.3</version>
    <configuration>
        <java>
            <eclipse>
                <file>.devtools/eclipse-formatter.xml</file>
            </eclipse>
        </java>
    </configuration>
</plugin>
```

Run with: `mvn spotless:apply`

### IntelliJ IDEA

Install the **Adapter for Eclipse Code Formatter** plugin:

**Settings → Plugins → Marketplace → search "Eclipse Code Formatter" → Install**

The plugin is pre-configured by devtools to use `.devtools/eclipse-formatter.xml`.

## Lombok

### Immutable Objects
* Use `@Value`, `@Builder`, and `@AllArgsConstructor(access = AccessLevel.PRIVATE)`.

### Mutable Objects
* Use `@Getter` and `@Setter` on class or field level.
* Use `@NoArgsConstructor` and `@AllArgsConstructor` as needed.
* Use `@Builder` for complex construction.

### Equals, HashCode, and ToString
* Prefer `@EqualsAndHashCode(onlyExplicitlyIncluded = true)` and `@ToString(onlyExplicitlyIncluded = true)`.
* Mark relevant fields with `@EqualsAndHashCode.Include` and `@ToString.Include`.

### Other Conventions
* Use `@RequiredArgsConstructor` for constructor injection.
* Use `@Slf4j` for logging.
* Use `val` for local variable type inference.
* Use `@Builder.Default` for default values in builders.

## Documentation
* Add Javadoc comments to all public classes, methods, and fields.
* Use single-line format for simple fields: `/** The username. */`
* Focus on what the code does, not who wrote it (no `@author`/`@since` tags).
* Document parameters with `@param`, return values with `@return`.

## Null Handling
* Use `Optional` for methods that might not return a value.
* Prefer `Optional.ofNullable(value).map(...).orElse(null)` over null checks.
* Use `@NotNull` and `@NotBlank` validation annotations on domain object fields.

## Collections
* Use `.stream().toList()` instead of `.collect(Collectors.toList())`.
* Use `EnumSet` for collections of enum values.
* Use `Map.ofEntries()` with `Map.entry()` for immutable maps.

## Imports
* Never use wildcard imports.
* Use Jakarta EE packages (`jakarta.persistence`, `jakarta.validation`), not `javax`.
