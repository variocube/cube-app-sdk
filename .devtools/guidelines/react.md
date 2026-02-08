# React Guidelines

## Build
* Use Vite with `@vitejs/plugin-react`, `vite-plugin-checker`, and `@variocube/vite-plugins`.
* Use the Vite dev server for local development.

## Components

### Functional Components Only
* Never use class components.
* Use `React.FC<Props>` or direct props typing.

### Component Files
* PascalCase for component files: `GroupList.tsx`, `EmailInput.tsx`.
* Co-locate related components in feature directories or below the main export.
* If JSX nesting hits a depth of 5, extract nested components.

### Props
* Define an interface for all props.
* Use `Readonly<Props>` for immutable props.
* Use `PropsWithChildren<Props>` when accepting children.
* Destructure props at the start of the component.

## Hooks

### Standard Hooks
* `useState` for local UI state.
* `useEffect` for side effects; always specify dependencies.
* `useMemo` for expensive computations and context values.
* `useCallback` for memoizing event handlers passed to children.

### Custom Hooks
* Prefix with `use`: `useLocationApi`, `useTenantId`.
* Return memoized values when the hook creates objects or functions.
* Throw descriptive errors when used outside required providers.

## State Management

### Local State
* Use `useState` for form inputs and UI state.
* Use `useReducer` for complex state logic with multiple sub-values.

### Global State
* Use Context API for app-wide state (auth, tenant, locale).
* Provide both a Provider component and a custom hook to access context.

### Server State
* Use React Query for data fetching, caching, and synchronization.
* Define query keys in a centralized `queryKeys.ts` file.
* Configure sensible defaults for `staleTime` and `refetchOnWindowFocus`.

## API Integration

### Generated Client
* Generate API client from OpenAPI spec.
* Create wrapper hooks that inject auth tokens and tenant context.

### API Hooks Pattern
```typescript
export function useLocationApi() {
  const accessToken = useAccessToken();
  const tenantId = useTenantId();
  return useMemo(() => createLocationApi(tenantId, accessToken), [tenantId, accessToken]);
}
```

### Error Handling
* Check error status codes for specific handling (404 → redirect).
* Display errors with dedicated error components.

### Loading States
* Use hooks that provide `{loading, error, result}`.
* Apply reduced opacity or skeleton UI during loading.

## Forms

### State Management
* Use `useState` for individual form fields.
* Sync state from props in `useEffect` when editing existing data.

### Validation
* Use HTML5 validation for simple cases (required, type="email").
* Use Zod schemas for complex validation.

### Pattern
```typescript
const [name, setName] = useState("");

useEffect(() => {
  if (entity) setName(entity.name);
}, [entity]);

async function handleSave() {
  await onSave({ name });
}
```

## UI Components

* Prefer components from `@variocube/app-ui` over plain MUI components.
* Use the `sx` prop for component-specific styles.
* Use the theme for consistent colors, spacing, and typography.
* Prefer <Stack> over <Grid> for simple layouts.
* Spacing: Use 2 for normal spacing, 1 for tight spacing, and 4 for wide spacing.

## Routing

### React Router
* Use nested routes with `Outlet` for layouts.
* Use `useNavigate()` for programmatic navigation.
* Create typed parameter hooks: `useParam()`, `useNumericParam()`.

## Project Structure
```
src/main/typescript/
├── api/           # API client and hooks
├── controls/      # Reusable UI components
├── hooks/         # Custom hooks
├── i18n/          # Localization
├── shell/         # Layout components
├── tenant/        # Feature modules
│   ├── users/
│   ├── groups/
│   └── bookings/
└── utils/         # Utility functions
```

## Barrel Exports
* Use `index.ts` for re-exporting from feature directories.
* Keep exports explicit; avoid `export *` from files with many exports.
