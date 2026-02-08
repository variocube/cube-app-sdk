# Spring Boot Guidelines

## Build
* Use Gradle with the Gradle Wrapper (`./gradlew`).
* Never commit changes to the Gradle Wrapper JAR without upgrading the wrapper version.

## Architecture

Each application consists of four layers/modules with clearly defined dependencies and responsibilities:

### Domain Objects
* Domain objects are simple POJOs.
* Domain objects are always immutable.
* Use Lombok's `@Value`, `@Builder` and `@AllArgsConstructor(access = AccessLevel.PRIVATE)` annotations on domain object classes.
* Comment each domain object and its properties with `javadoc` comments.
* Never use class inheritance for modeling domain objects. Using interfaces is acceptable.
* Use validation annotations on the properties of a domain object.
* Validation with `@Valid` is performed at both inbound adapter (controller) and command boundaries. This ensures both DTOs and domain objects are validated, which matters when they differ (e.g., legacy API endpoints).
* Objects that contain the data required for a command (e.g. `OrderCreation` or `OrderMutation`) are also domain objects.
* Put domain objects into the package `domain` under application's root package. Use further sub-packages to structure by domain (e.g. `order`) 

### JPA Entities
* JPA entities are mutable and use `@Entity(name = "...")`, `@Getter`, `@Setter`, `@NoArgsConstructor(access = AccessLevel.PROTECTED)`, `@AllArgsConstructor`, and `@Builder`.
* Always specify the entity name in `@Entity(name = "...")` so it can be used in JPQL queries.
* Use `@EqualsAndHashCode(onlyExplicitlyIncluded = true)` and `@ToString(onlyExplicitlyIncluded = true)`, marking only the ID field with `@EqualsAndHashCode.Include` and `@ToString.Include`.
* Name entity classes with an `Entity` suffix (e.g., `OrderEntity`) to distinguish them from domain objects.
* Put entities into the `out.store` package alongside their corresponding `Store` and `Repository`.

### Outbound adapters
* Outbound adapters encapsulate external services and subsystems (this includes libraries).
* Outbound adapters depend on the domain objects and can accept them as parameters and return them as return values.
* Their API should not leak details about the underlying service or subsystem.
* Typical outbound adapters are data stores or specific-purpose libraries (e.g. PDF generation, QR-code detection).
* Put outbound adapters into the package `out` under the application's root package. Use further sub-packages to structure by subsystem (e.g. `store` for data stores or `pdf` for a PDF library).
* Use `mapstruct` to map between domain objects and outbound adapters specific types (e.g., between the domain object `Order` and the JPA entity `OrderEntity`).
* Don't define an interface for an adapter unless there are multiple implementations.
* Naming convention:
  * The name of an outbound adapter typically consists of the domain and the adapter type, e.g. `OrderStore`.
  * If there are multiple implementations of an adapter, use the generic name for the interface and a specialized name for the implementation, e.g. `Mailer` and `SmtpMailer`.  
* Outbound adapters are beans annotated with `@Component` or one of its subtypes.

### Application
* Contains the application's logic (commands) and depends on the domain model and outbound adapters.
* Each command that the application implements goes into a separate class, e.g. `GetOrder`, `CreateOrder` or `CalculateOrderTotal`.
  * The class has a single public method to invoke the functionality, e.g. `Order createOrder(String tenantId, @Valid OrderCreation orderCreation)`.
  * There might be a number of private methods to further structure the implementation.
  * The class is a bean annotated with `@Component`.
* If there is shared functionality between such command classes, it can be extracted into a package-private helper command.
* A command should always validate its input data, e.g., by using `@Valid` on its parameters.
* A command should perform authorization.

### Inbound adapters
* Inbound adapters are what actually drive the application. These can be internal triggers (events like application start-up, timers/cronjobs), or APIs that the application exposes.
* Inbound adapters depend on the domain model and the application.
* Inbound adapters can accept/expose domain objects as part of their external API. However, if different representations are required (e.g., in a versioned API), use `mapstruct` for the mapping.
* Put inbound adapters into the package `in` under the application's root package. Use further sub-packages to structure by subsystem (e.g., `web` for Web APIs like REST controllers, or `timer` for scheduled jobs).
* Inbound adapters are beans annotated with `@Component` or one of its subtypes.
* Use `mapstruct` to map between domain objects and inbound adapter specific types (e.g., between the domain object `Order` and a legacy DTO `OrderV1`).
* Naming convention:
  * The name of an inbound adapter typically consists of the domain and the adapter type, e.g. `OrderApi`.
  * Optionally, an additional noun can indicate the functionality triggered by the inbound adapter, e.g. `OrderArchivalJob`.

## Prefer Constructor Injection over Field/Setter Injection
* Declare all the mandatory dependencies as `final` fields and inject them through the constructor.
* Use Lombok's `@RequiredArgsContructor` to generate the constructor.
* Spring will auto-detect if there is only one constructor, no need to add `@Autowired` on the constructor.
* Avoid field/setter injection in production code.

## Prefer package-private over public for Spring components
* Declare Controllers, their request-handling methods, `@Configuration` classes and `@Bean` methods with default (package-private) visibility whenever possible. There's no obligation to make everything `public`.

## Configuration

### Organize Configuration with Typed Properties
* Group application-specific configuration properties with a common prefix in `application.yml`.
* Bind them to `@ConfigurationProperties` classes with validation annotations so that the application will fail fast if the configuration is invalid.
* Prefer environment variables instead of profiles for passing different configuration properties for different environments.
* `@ConfigurationProperties` classes should be placed next to consuming bean.

### Configuration beans
* Place beans that configure a certain subsystem into the corresponding package, e.g.
  * a configuration implementing `WebMvcConfigurer` should go into `in.web`
  * a bean implementing `Filter` should go into `in.web`
  * a `SecurityFilterChain` bean should go into `in.web`

### Secrets and sensitive configuration
* Never put secrets or sensitive configuration into `application.yml`, the source code or any other file that is subject to version control or will be bundled in build artifacts.

## Define Clear Transaction Boundaries
* Annotate service classes with `@Transactional(readOnly = true)` by default.
* Override with `@Transactional` on individual data-modifying methods.
* Limit the code inside each transaction to the smallest necessary scope.
* Only call network services other than the database in a transaction when a short (less than one second) time-out is guaranteed.

## Use generic exceptions where possible and avoid checked exceptions
* Use generic exceptions instead of creating custom exceptions, e.g., use `EntityNotFoundException` instead of creating an `OrderNotFoundException`.
* Create specific exceptions only when the calling code can reasonably handle that specific error condition, *and* it needs to distinguish this error condition from others.

## Disable Open Session in View Pattern
* While using Spring Data JPA, disable the Open Session in View filter by setting ` spring.jpa.open-in-view=false` in `application.properties/yml.`

## Follow REST API Design Principles
* **Versioned, resource-oriented URLs:** Structure your endpoints as `/api/v{version}/resources` (e.g. `/api/v1/orders`).
* **Consistent patterns for collections and sub-resources:** Keep URL conventions uniform (for example, `/posts` for posts collection and `/posts/{slug}/comments` for comments of a specific post).
* Use SpringDoc to generate OpenAPI schemas and Swagger documentation. Prefer SpringDoc's Javadoc extension instead of using annotations where possible.
* Use Spring Data's `Pageable` and `Page` for collection resources that may contain an unbounded number of items.

## Centralize Exception Handling
* Define a global handler class annotated with `@ControllerAdvice` (or `@RestControllerAdvice` for REST APIs) using `@ExceptionHandler` methods to handle specific exceptions.
* Put the global handler class next to the actual controllers, typically into the `in.web` package under the application's root package.
* Return consistent error responses. Use the ProblemDetails response format ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)).

## Security
* Use JWT/OAuth2 with Spring Resource Server and the `com.variocube:idp` library for authentication.
* Implement authorization logic as regular code within commands rather than using method-level security annotations (`@PreAuthorize`, `@Secured`). This provides better control in multi-tenant systems with varying permission granularity.
* Configure CORS as needed for the specific deployment scenario.

## Actuator
* Expose only essential actuator endpoints (such as `/health`, `/info`, `/metrics`) without requiring authentication. All the other actuator endpoints must be secured.

## Internationalization with ResourceBundles
* Externalize all user-facing text such as labels, prompts, and messages into ResourceBundles rather than embedding them in code.

## Testing
* Prefer integration tests over unit tests. Heavy mocking often tests mock behavior rather than business logic.
* Testing approach in order of preference:
  1. **API-level integration tests** using `MockMvc` to verify endpoint behavior. Often sufficient for CRUD operations.
  2. **Use-case level integration tests** for complex logic with multiple input/state permutations. Use when `MockMvc` overhead is too high.
  3. **Unit tests for decoupled algorithms** - extract complex business logic into separate methods or helper commands that are easy to unit test without dependencies.
  4. **Mocking** only when other approaches don't work (e.g., external libraries).
* Use Testcontainers to spin up real services (databases, message brokers, etc.) in integration tests to mirror production environments.

## Database and migrations
* When starting the application with the default profile, the application should use a testcontainer for the database and load demo data. This allows running the application immediately without external setup.
* A separate `db` (or `mariadb`) profile configures a locally running database (e.g. `mariadb://localhost:3306`) without demo data.
* Demo data loading can be controlled explicitly via the `<app-name>.demo` property when needed.
* Use Flyway for migrations and use the baseline feature to provide an up-to-date schema for a faster startup with the testcontainer.
* Always set `spring.jpa.hibernate.ddl-auto=validate` to ensure the schema matches the entity definition.

## Logging
* Use Lombok's `@Slf4j` annotation on classes that need logging.
* Never log credentials, personal information, or other confidential details.
* Guard expensive log message construction at `DEBUG`/`TRACE` level with `log.isDebugEnabled()` or use the fluent API with suppliers.
