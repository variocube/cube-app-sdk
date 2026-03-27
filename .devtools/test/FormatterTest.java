package test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Test file for validating Eclipse formatter settings. Format this file to verify formatting rules work as expected.
 *
 * @author Test
 * @see Object
 */
@SuppressWarnings({ "unused", "OptionalUsedAsFieldOrParameterType" })
public class FormatterTest implements Comparable<FormatterTest>, Cloneable {

	// ===========================================
	// Method chaining and assignments
	// ===========================================

	public void methodChainingWithAssignment() {
		// Method chain should wrap at dots, not after =
		String result = repository.findById(id)
				.map(Entity::getName)
				.filter(name -> !name.isEmpty())
				.orElse("default");

		// Optional chain
		Optional<String> optional = service.getData()
				.flatMap(this::transform)
				.filter(s -> s.length() > 5)
				.map(String::toUpperCase);

		// Builder pattern
		Person person = Person.builder()
				.firstName("John")
				.lastName("Doe")
				.age(30)
				.email("john@example.com")
				.address("123 Main St")
				.build();
	}

	// ===========================================
	// Stream operations
	// ===========================================

	public List<String> streamOperations(List<User> users) {
		// Stream with multiple operations
		List<String> names = users.stream()
				.filter(User::isActive)
				.filter(u -> u.getAge() > 18)
				.map(User::getName)
				.map(String::toUpperCase)
				.sorted()
				.distinct()
				.collect(Collectors.toList());

		// Grouping
		Map<String, List<User>> grouped = users.stream()
				.filter(u -> u.getDepartment() != null)
				.collect(Collectors.groupingBy(User::getDepartment, Collectors.toList()));

		return names;
	}

	// ===========================================
	// Method declarations with many parameters
	// ===========================================

	public void methodWithManyParameters(
			String firstName,
			String lastName,
			int age,
			String email,
			String phone,
			String address,
			String city,
			String country) {
		// Body
	}

	public <T extends Comparable<T>, R> R genericMethodWithManyParams(
			List<T> items,
			Function<T, R> mapper,
			R defaultValue,
			boolean sorted) {
		return defaultValue;
	}

	// ===========================================
	// Constructors
	// ===========================================

	public FormatterTest() {
	}

	public FormatterTest(String name, int value, boolean flag, List<String> items, Map<String, Object> properties) {
		// Constructor with many params
	}

	// ===========================================
	// Control flow: if/else
	// ===========================================

	public void ifElseStatements(int value) {
		// Simple if
		if (value > 0) {
			doSomething();
		}

		// If-else
		if (value > 0) {
			doSomething();
		}
		else {
			doSomethingElse();
		}

		// If-else-if chain
		if (value > 100) {
			doSomething();
		}
		else if (value > 50) {
			doSomethingElse();
		}
		else if (value > 0) {
			doAnother();
		}
		else {
			doDefault();
		}
	}

	// ===========================================
	// Control flow: switch
	// ===========================================

	public String switchStatements(int value) {
		// Classic switch
		switch (value) {
			case 1:
				return "one";
			case 2:
				return "two";
			case 3:
			case 4:
				return "three or four";
			default:
				return "other";
		}
	}

	public String switchExpression(String day) {
		// Switch expression (Java 14+)
		return switch (day) {
			case "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY" -> "weekday";
			case "SATURDAY", "SUNDAY" -> "weekend";
			default -> "unknown";
		};
	}

	// ===========================================
	// Control flow: try/catch/finally
	// ===========================================

	public void tryCatchFinally() {
		try {
			riskyOperation();
		}
		catch (IllegalArgumentException e) {
			handleIllegalArgument(e);
		}
		catch (RuntimeException e) {
			handleRuntime(e);
		}
		finally {
			cleanup();
		}

		// Try with resources
		try (var resource = openResource(); var another = openAnother()) {
			useResources(resource, another);
		}
		catch (Exception e) {
			log(e);
		}

		// Multi-catch
		try {
			riskyOperation();
		}
		catch (IllegalArgumentException | IllegalStateException | NullPointerException e) {
			handleError(e);
		}
	}

	// ===========================================
	// Control flow: loops
	// ===========================================

	public void loops() {
		// For loop
		for (int i = 0; i < 10; i++) {
			process(i);
		}

		// Enhanced for
		for (String item : items) {
			process(item);
		}

		// While
		while (condition()) {
			doWork();
		}

		// Do-while
		do {
			doWork();
		}
		while (condition());
	}

	// ===========================================
	// Lambda expressions
	// ===========================================

	public void lambdaExpressions() {
		// Simple lambda
		Runnable r = () -> doSomething();

		// Lambda with params
		Function<String, Integer> f = s -> s.length();

		// Lambda with block
		Function<String, String> transform = s -> {
			String trimmed = s.trim();
			return trimmed.toUpperCase();
		};

		// Lambda with multiple params
		BiFunction<String, Integer, String> repeat = (str, count) -> str.repeat(count);

		// Method reference
		Function<String, Integer> len = String::length;
	}

	// ===========================================
	// Anonymous classes
	// ===========================================

	public void anonymousClasses() {
		Runnable r = new Runnable() {
			@Override
			public void run() {
				doSomething();
			}
		};

		Comparator<String> comp = new Comparator<String>() {
			@Override
			public int compare(String o1, String o2) {
				return o1.compareToIgnoreCase(o2);
			}
		};
	}

	// ===========================================
	// Annotations
	// ===========================================

	@Override
	public int compareTo(FormatterTest other) {
		return 0;
	}

	@SuppressWarnings("unchecked")
	@Deprecated(since = "1.0", forRemoval = true)
	public void annotatedMethod() {
	}

	@CustomAnnotation(value = "test", count = 5, tags = { "a", "b", "c" }, nested = @Nested(name = "inner"))
	public void complexAnnotation() {
	}

	// ===========================================
	// Generics
	// ===========================================

	public <T extends Comparable<T> & Serializable> List<T> genericMethod(List<? extends T> input, Class<T> type) {
		return null;
	}

	public Map<String, List<Map<Integer, Set<String>>>> deeplyNestedGenerics() {
		return null;
	}

	// ===========================================
	// Array initializers
	// ===========================================

	public void arrayInitializers() {
		int[] simple = { 1, 2, 3, 4, 5 };

		int[] longer = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 };

		String[][] matrix = { { "a", "b", "c" }, { "d", "e", "f" }, { "g", "h", "i" } };

		int[][] numbers = { { 1, 2, 3 }, { 4, 5, 6 }, { 7, 8, 9 } };
	}

	// ===========================================
	// Binary and ternary expressions
	// ===========================================

	public void expressions() {
		// Long binary expression
		boolean result = condition1() && condition2() && condition3() || condition4() && condition5() || condition6();

		// String concatenation
		String message = "Hello " + firstName + " " + lastName + "! Your order #" + orderId + " has been " + status
				+ ".";

		// Ternary
		String value = condition() ? "yes" : "no";

		// Nested ternary
		String level = score > 90 ? "A" : score > 80 ? "B" : score > 70 ? "C" : score > 60 ? "D" : "F";

		// Arithmetic
		double calculation = (a + b) * (c - d) / (e + f) + Math.pow(g, h) - Math.sqrt(i);
	}

	// ===========================================
	// Method invocations with many arguments
	// ===========================================

	public void methodInvocations() {
		// Many arguments
		callMethod("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth");

		// Nested calls
		process(transform(validate(parse(input))));

		// Mixed chains and arguments
		result = service.getData(param1, param2)
				.transform(arg1, arg2, arg3)
				.filter(x -> x.isValid())
				.collect();
	}

	// ===========================================
	// Records (Java 16+)
	// ===========================================

	public record Point(int x, int y) {
	}

	public record Person(String firstName, String lastName, int age, String email, String phone, Address address)
			implements
			Serializable {
		public Person {
			if (age < 0) {
				throw new IllegalArgumentException("Age cannot be negative");
			}
		}
	}

	// ===========================================
	// Sealed classes (Java 17+)
	// ===========================================

	public sealed interface Shape permits Circle, Rectangle, Triangle {
		double area();
	}

	public final class Circle implements Shape {
		private final double radius;

		public Circle(double radius) {
			this.radius = radius;
		}

		@Override
		public double area() {
			return Math.PI * radius * radius;
		}
	}

	// ===========================================
	// Pattern matching (Java 16+)
	// ===========================================

	public void patternMatching(Object obj) {
		// instanceof pattern
		if (obj instanceof String s) {
			System.out.println(s.toUpperCase());
		}

		if (obj instanceof List<?> list && !list.isEmpty()) {
			process(list);
		}

		// Switch pattern (Java 21+)
		String result = switch (obj) {
			case Integer i -> "Integer: " + i;
			case String s -> "String: " + s;
			case List<?> l -> "List of size: " + l.size();
			case null -> "null";
			default -> "Unknown";
		};
	}

	// ===========================================
	// Text blocks (Java 15+)
	// ===========================================

	public void textBlocks() {
		String json = """
				{
					"name": "John",
					"age": 30,
					"active": true
				}
				""";

		String html = """
				<html>
					<body>
						<h1>Hello World</h1>
					</body>
				</html>
				""";
	}

	// ===========================================
	// Enum
	// ===========================================

	public enum Status {
		PENDING,
		ACTIVE,
		COMPLETED,
		CANCELLED;

		public boolean isTerminal() {
			return this == COMPLETED || this == CANCELLED;
		}
	}

	public enum Operation {
		ADD("+") {
			@Override
			public int apply(int a, int b) {
				return a + b;
			}
		},
		SUBTRACT("-") {
			@Override
			public int apply(int a, int b) {
				return a - b;
			}
		};

		private final String symbol;

		Operation(String symbol) {
			this.symbol = symbol;
		}

		public abstract int apply(int a, int b);
	}

	// ===========================================
	// Inner classes
	// ===========================================

	public class InnerClass {
		private String value;

		public void method() {
			// Access outer class
			FormatterTest.this.doSomething();
		}
	}

	public static class StaticNestedClass {
		public void method() {
		}
	}

	// ===========================================
	// Stub methods and fields for compilation
	// ===========================================

	private Repository repository;
	private Service service;
	private String id;
	private List<String> items;
	private String firstName, lastName;
	private int orderId, score;
	private String status, input;
	private double a, b, c, d, e, f, g, h, i;
	private Object result;

	private void doSomething() {
	}

	private void doSomethingElse() {
	}

	private void doAnother() {
	}

	private void doDefault() {
	}

	private boolean condition() {
		return false;
	}

	private boolean condition1() {
		return false;
	}

	private boolean condition2() {
		return false;
	}

	private boolean condition3() {
		return false;
	}

	private boolean condition4() {
		return false;
	}

	private boolean condition5() {
		return false;
	}

	private boolean condition6() {
		return false;
	}

	private void riskyOperation() {
	}

	private void handleIllegalArgument(Exception e) {
	}

	private void handleRuntime(Exception e) {
	}

	private void handleError(Exception e) {
	}

	private void cleanup() {
	}

	private void log(Exception e) {
	}

	private Resource openResource() {
		return null;
	}

	private Resource openAnother() {
		return null;
	}

	private void useResources(Resource... r) {
	}

	private void process(Object o) {
	}

	private void doWork() {
	}

	private void callMethod(String... args) {
	}

	private Object transform(Object o) {
		return o;
	}

	private Object validate(Object o) {
		return o;
	}

	private Object parse(Object o) {
		return o;
	}

	private Optional<String> transform(Object o) {
		return Optional.empty();
	}

	interface Repository {
		Optional<Entity> findById(String id);
	}

	interface Entity {
		String getName();
	}

	interface Service {
		Optional<Object> getData();
	}

	interface User {
		boolean isActive();

		int getAge();

		String getName();

		String getDepartment();
	}

	interface Person {
		static PersonBuilder builder() {
			return null;
		}
	}

	interface PersonBuilder {
		PersonBuilder firstName(String s);

		PersonBuilder lastName(String s);

		PersonBuilder age(int a);

		PersonBuilder email(String s);

		PersonBuilder address(String s);

		Person build();
	}

	interface BiFunction<T, U, R> {
		R apply(T t, U u);
	}

	interface Comparator<T> {
		int compare(T o1, T o2);
	}

	interface Resource extends AutoCloseable {
		void close();
	}

	interface Address {
	}

	@interface CustomAnnotation {
		String value();

		int count();

		String[] tags();

		Nested nested();
	}

	@interface Nested {
		String name();
	}

	final class Rectangle implements Shape {
		public double area() {
			return 0;
		}
	}

	final class Triangle implements Shape {
		public double area() {
			return 0;
		}
	}
}
