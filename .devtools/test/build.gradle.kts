plugins {
    java
    id("com.diffplug.spotless") version "8.2.1"
}

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

spotless {
    java {
        target("**/*.java")
        eclipse().configFile("../eclipse-formatter.xml")
        trimTrailingWhitespace()
        endWithNewline()
    }
}
