# UI/UX Patterns

All UI components referenced here are from `@variocube/app-ui` unless noted otherwise.

## Page Layout

Every page follows the same structure: `View` > `Breadcrumbs` > `ViewHeader` > content.

### View

Wraps the page in a `Container` with consistent spacing and error handling.

```tsx
<View loading={loading} error={error}>
  {/* Breadcrumbs, ViewHeader, content */}
</View>
```

Props: `loading` (reduces opacity), `error` (shows `ErrorAlert`), `maxWidth` (Container width).

### ViewHeader

Displays the page title with optional adornments, subtitle, and action buttons.

```tsx
<ViewHeader
  title="Locker 42"
  titleAdornment={
    <Stack direction="row" spacing={1} alignItems="center">
      <Chip label="Premium" />
      <DisabledChip />
    </Stack>
  }
  subTitle={<LocationLinkChip location={parent} />}
  actions={
    <Stack direction="row" spacing={1}>
      <Button variant="outlined" component={Link} to="edit">{t("edit")}</Button>
    </Stack>
  }
/>
```

- **title**: Page heading text.
- **titleAdornment**: Chips, badges, or status indicators shown next to the title.
- **subTitle**: Secondary info below the title (e.g., parent link).
- **actions**: Buttons aligned to the right. Use `<Stack direction="row" spacing={1}>` for multiple actions. Primary action uses `variant="contained"`, secondary actions use `variant="outlined"`.

### Breadcrumbs

Navigation trail placed as the first child inside `View`.

```tsx
<Breadcrumbs>
  <BreadcrumbLink component={Link} to=".." relative="path">{t("groups.title")}</BreadcrumbLink>
  <BreadcrumbItem>{group.name}</BreadcrumbItem>
</Breadcrumbs>
```

- Use `BreadcrumbLink` with `component={Link}` for clickable segments.
- Use `BreadcrumbItem` for the current (non-clickable) page.
- Use relative paths (`".."`, `"../.."`) with `relative="path"`.
- Edit pages have 3 levels: list link > entity link > "Edit".

```tsx
{/* Edit page breadcrumbs */}
<Breadcrumbs>
  <BreadcrumbLink component={Link} to="../.." relative="path">{t("groups.title")}</BreadcrumbLink>
  <BreadcrumbLink component={Link} to=".." relative="path">{group?.name}</BreadcrumbLink>
  <BreadcrumbItem>{t("edit")}</BreadcrumbItem>
</Breadcrumbs>
```

### Complete view page example

```tsx
export function GroupView() {
  const {t} = useLocalization();
  const groupId = useNumericParam("groupId");
  const {getGroup} = useGroupApi();
  const canEdit = useTenantPermission("GROUP_EDIT");

  const {loading, error, result} = useAsync(getGroup, [groupId]);

  return (
    <View loading={loading} error={error}>
      <Breadcrumbs>
        <BreadcrumbLink component={Link} to="..">{t("groups.title")}</BreadcrumbLink>
        <BreadcrumbItem>{result?.name}</BreadcrumbItem>
      </Breadcrumbs>
      <ViewHeader
        title={result?.name ?? ""}
        titleAdornment={result?.defaultGroup && <Chip label={t("groups.defaultGroup.title")} />}
        actions={canEdit && (
          <Button color="primary" variant="outlined" component={Link} to="edit">
            {t("edit")}
          </Button>
        )}
      />
      {/* Tab content, detail cards, etc. */}
    </View>
  );
}
```

## List Views with DataTable

List pages use a standard hook chain for server-side pagination and sorting.

### Hook chain

```tsx
const {onPageChange, onSort, ...storage} = useDataTableStorage("GroupList.paging");
const pageable = useSpringPageable(storage);
const [filter, setFilter] = useStorage<GroupFilter>("GroupList.filter", defaultFilter);

const query = useMemo(() => ({...filter, ...pageable}), [filter, pageable]);

const {loading, error, result} = useAsync(queryGroups, [query]);
const {rows, page} = useSpringPage(result);
```

1. `useDataTableStorage(key)` — persists sort field, sort direction, page index, and page size.
2. `useSpringPageable(storage)` — converts storage into Spring Data `Pageable` query parameters.
3. Merge filter + pageable into a single query object.
4. Pass query to API hook via `useAsync`.
5. `useSpringPage(result)` — extracts `rows` and `page` from the Spring `Page` response.

### Filter component

Define a filter type as the query type minus pageable fields:

```tsx
export type GroupFilter = Omit<GroupQuery, keyof SpringPageable>;
```

Use the `Filter` component with `enableSearch`, active filter chips, and filter controls:

```tsx
<Filter
  label={t("filter.title")}
  enableSearch
  onSearch={onSearch}
  active={[
    value.search && (
      <Chip
        key="search"
        label={`${t("filter.search")}: ${value.search}`}
        onDelete={() => onSearch(undefined)}
      />
    ),
  ]}
  labels={s("filter")}
>
  <CardContent>
    {/* Filter controls (selects, checkboxes, etc.) */}
  </CardContent>
</Filter>
```

### Column definitions

Define columns as an array with `field`, `label`, `sortable`, `default`, and optional custom `component`:

```tsx
function createColumns(t: TFunc) {
  return [
    {
      label: t("users.displayName"),
      field: "displayName",
      sortable: true,
      default: true,
      component: ({row}: DataTableCellProps<User>) => <UserLinkChip user={row} />,
    },
    {
      label: t("users.email"),
      field: "email",
      sortable: true,
      default: true,
    },
  ];
}
```

- `field` must match the backend sort property name.
- `default: true` means the column is visible by default.
- Custom `component` receives `{row, column}` via `DataTableCellProps<T>`.

### Complete list view example

```tsx
const defaultFilter: GroupFilter = {};

export function GroupList() {
  const {t} = useLocalization();
  const {queryGroups} = useGroupApi();
  const columns = useMemo(() => createColumns(t), [t]);
  const {onPageChange, onSort, ...storage} = useDataTableStorage("GroupList.paging");
  const pageable = useSpringPageable(storage);
  const [filter, setFilter] = useStorage<GroupFilter>("GroupList.filter", defaultFilter);

  const canCreate = useTenantPermission("GROUP_CREATE");

  const query = useMemo(() => ({...filter, ...pageable}), [filter, pageable]);

  const {loading, error, result} = useAsync(queryGroups, [query]);
  const {rows, page} = useSpringPage(result);

  return (
    <View>
      <ViewHeader
        title={t("groups.title")}
        actions={canCreate && (
          <Button color="primary" variant="contained" component={Link} to="new">
            {t("groups.create.title")}
          </Button>
        )}
      />
      <GroupFilter value={filter} onChange={setFilter} onSearch={search => setFilter({...filter, search})} />
      <DataTable
        columns={columns}
        rows={rows}
        page={page}
        loading={loading}
        error={error}
        onSort={onSort}
        onPageChange={onPageChange}
        empty={<EmptyList />}
        {...storage}
      />
    </View>
  );
}
```

## Create and Edit Views with EditForm

### EditForm

Wraps form fields in a `Card` with a submit button, loading state, and error display.

```tsx
<EditForm loading={loading} onSave={handleSave} labels={t}>
  <CardContent>
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6} md={4}>
        <TextField label={t("name")} value={name} onChange={setName} fullWidth required />
      </Grid>
    </Grid>
  </CardContent>
</EditForm>
```

Props: `loading` (disables form), `onSave` (async, called on submit), `labels` (translation function for "save"/"cancel" buttons).

Use `CardContent` sections for form field groups. Use `Grid` for field layout. Use `CardHeader` to title separate sections within the form.

### Shared form component

Extract the form into a reusable component that both create and edit pages use:

```tsx
interface GroupEditFormProps {
  loading: boolean;
  group?: Group;            // undefined for create, provided for edit
  onSave: (mutation: GroupMutation) => Promise<any>;
}

export function GroupEditForm({loading, group, onSave}: GroupEditFormProps) {
  const {t} = useLocalization();
  const [name, setName] = useState("");

  useEffect(() => {
    if (group) {
      setName(group.name);
    }
  }, [group]);

  async function handleSave() {
    await onSave({name});
  }

  return (
    <EditForm loading={loading} onSave={handleSave} labels={t}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4}>
            <TextField label={t("groups.name")} value={name} onChange={setName} fullWidth required />
          </Grid>
        </Grid>
      </CardContent>
    </EditForm>
  );
}
```

### Create page

- Pass `loading={false}` (no entity to load).
- Navigate to the created entity on save.

```tsx
export function GroupCreate() {
  const {t} = useLocalization();
  const navigate = useNavigate();
  const {createGroup} = useGroupApi();

  async function handleSave(mutation: GroupMutation) {
    const created = await createGroup(mutation);
    navigate(`../${created.id}`);
  }

  return (
    <View>
      <Breadcrumbs>
        <BreadcrumbLink component={Link} to=".." relative="path">{t("groups.title")}</BreadcrumbLink>
        <BreadcrumbItem>{t("groups.create.title")}</BreadcrumbItem>
      </Breadcrumbs>
      <ViewHeader title={t("groups.create.title")} />
      <GroupEditForm loading={false} onSave={handleSave} />
    </View>
  );
}
```

### Edit page

- Load the entity with `useAsync`, sync to local state via `useEffect`.
- Navigate back on save.

```tsx
export function GroupEdit() {
  const {t} = useLocalization();
  const navigate = useNavigate();
  const groupId = useNumericParam("groupId");
  const {getGroup, updateGroup} = useGroupApi();

  const [group, setGroup] = useState<Group>();
  const {loading, error, result} = useAsync(getGroup, [groupId]);

  useEffect(() => { setGroup(result); }, [result]);

  async function handleSave(mutation: GroupMutation) {
    setGroup(await updateGroup(groupId, mutation));
  }

  return (
    <View error={error}>
      <Breadcrumbs>
        <BreadcrumbLink component={Link} to="../.." relative="path">{t("groups.title")}</BreadcrumbLink>
        <BreadcrumbLink component={Link} to=".." relative="path">{group?.name}</BreadcrumbLink>
        <BreadcrumbItem>{t("edit")}</BreadcrumbItem>
      </Breadcrumbs>
      <ViewHeader title={t("groups.edit.title", group)} />
      <GroupEditForm loading={loading} group={group} onSave={handleSave} />
      {/* Deletion section — see below */}
    </View>
  );
}
```

## Deletion

### Entity deletion on edit pages

Place an `Alert` with `severity="error"` at the **bottom** of the edit view. The `ConfirmButton` goes in the Alert's `action` prop. Conditionally render based on the delete permission.

```tsx
{canDelete && (
  <Alert
    severity="error"
    action={
      <ConfirmButton
        cancel={t("cancel")}
        title={t("groups.delete.title")}
        onConfirm={handleDelete}
        color="error"
      >
        {t("groups.delete.confirm")}
      </ConfirmButton>
    }
  >
    <AlertTitle>{t("groups.delete.title")}</AlertTitle>
    {t("groups.delete.message")}
  </Alert>
)}
```

- `Alert` provides the warning context (title + message explaining consequences).
- `ConfirmButton` opens a confirmation dialog. Its `children` are the dialog body text.
- `color="error"` makes both the Alert and button red.
- After deletion, navigate to the list page.

### Dangerous actions in ViewHeader

For "end", "cancel", or "deactivate" operations, place a `ConfirmButton` in `ViewHeader.actions`:

```tsx
<ViewHeader
  title={t("bookings.view.title")}
  actions={
    <Stack direction="row" spacing={2}>
      <ConfirmButton
        variant="outlined"
        cancel={t("cancel")}
        title={t("bookings.end.title")}
        onConfirm={handleEndBooking}
      >
        {t("bookings.end.message")}
      </ConfirmButton>
      <Button variant="outlined" component={Link} to="edit">{t("edit")}</Button>
    </Stack>
  }
/>
```

### Inline deletion in lists

Use `ConfirmIconButton` for removing items from lists or cards:

```tsx
{/* In a ListItem */}
<ListItemSecondaryAction>
  <ConfirmIconButton
    title={t("users.groups.remove.title")}
    cancel={t("cancel")}
    onConfirm={() => handleRemove(item)}
    icon={<Delete />}
    color="error"
  >
    {t("users.groups.remove.confirm", {name: item.name})}
  </ConfirmIconButton>
</ListItemSecondaryAction>

{/* In a CardHeader */}
<CardHeader
  title={role.name}
  action={
    <ConfirmIconButton
      icon={<Delete />}
      onConfirm={() => handleDelete(role)}
      title={t("roles.delete.title")}
      cancel={t("cancel")}
      color="error"
    >
      {t("roles.delete.confirm")}
    </ConfirmIconButton>
  }
/>
```
