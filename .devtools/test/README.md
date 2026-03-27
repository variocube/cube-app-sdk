# Formatter Test

Test Java file with various language constructs for validating Eclipse formatter settings.

## Files

- `FormatterTest.java` - Test file covering all Java language constructs
- `build.gradle.kts` - Gradle build with Spotless plugin
- `gradlew` / `gradlew.bat` - Gradle wrapper scripts

## Usage

### Format files

```bash
./gradlew spotlessApply
```

### Check formatting (CI mode)

```bash
./gradlew spotlessCheck
```

### IntelliJ IDEA

1. Open `FormatterTest.java` in IntelliJ
2. Press `Ctrl+Alt+L` (Windows/Linux) or `Cmd+Option+L` (Mac)

## What to Check After Formatting

### Method Chaining
Assignment stays on same line, chains wrap at dots:
```java
// Correct
String result = repository.findById(id)
    .map(Entity::getName)
    .orElse("default");

// Wrong
String result =
        repository.findById(id).map(Entity::getName).orElse("default");
```

### else/catch/finally on New Line
```java
// Correct
if (condition) {
    doSomething();
}
else {
    doOther();
}
```

### Parameter Wrapping (Chop Down if Long)
```java
// Short - all on one line
void method(String a, int b) { }

// Long - one per line
void method(
        String firstName,
        String lastName,
        int age
) { }
```
