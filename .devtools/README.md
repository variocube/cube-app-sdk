# devtools

Variocube developer tools

## Installation

Run this command in the root of your project:

```bash
wget -qO- https://raw.githubusercontent.com/variocube/devtools/main/devtools.sh | bash
```

This will:
1. Download and install devtools into `.devtools/`
2. Create symlinks for configuration files
3. Set up IntelliJ IDEA and GitHub templates

Commit the `.devtools` directory and created symlinks to your repository.

## Updating

To update to the latest version:

```bash
./devtools.sh update
```

Or simply run without arguments:

```bash
./devtools.sh
```

## Commands

| Command | Description |
|---------|-------------|
| `./devtools.sh` | Install or update devtools |
| `./devtools.sh update` | Alias for install/update |
| `./devtools.sh db:create` | Create local MySQL database |
| `./devtools.sh db:drop` | Drop local MySQL database |
| `./devtools.sh db:import` | Import database from S3 backup |
| `./devtools.sh db:import -d file.sql` | Import specific dump file |
| `./devtools.sh db:clean` | Delete downloaded database dumps |
| `./devtools.sh logs` | Tail CloudWatch logs (default: app stage) |
| `./devtools.sh logs -s prod` | Tail logs for specific stage |
| `./devtools.sh help` | Show help message |

## Configuration

Configuration is stored in `.vc` and created interactively when needed. You'll be prompted for values the first time you use a command that requires them.

Available settings:
- `DATABASE_NAME` - Database name for local MySQL operations
- `VC_AWS_PROFILE` - AWS CLI profile name
- `VC_AWS_REGION` - AWS region
- `CLOUD_WATCH_LOG_GROUP_<stage>` - CloudWatch log group per stage

## Included Tools

### EditorConfig

EditorConfig provides basic editor settings that are supported out of the box by most editors.

The provided EditorConfig does not set the `root = true` directive. This allows developers to
provide certain settings from an EditorConfig in a parent directory, most notably the `tab_width`.

### dprint

dprint is a code formatter for JavaScript, TypeScript, JSON, Dockerfile, Markdown.

Add the `dprint` package to your project:

```shell
npm install --save-dev dprint
```

You can use the provided configuration or create a project-specific configuration that
extends the provided configuration.

#### Extend the provided configuration

Create a `dprint.json` file that extends the provided configuration:

```json
{
  "extends": ".devtools/config/dprint.json"
}
```

#### Configure IntelliJ

Install the `dprint` plugin for IntelliJ and enable it in settings.

The devtools installation automatically links the necessary IDEA configuration files.

## Notes

**Linux users:** Leave the MySQL password empty when prompted to use sudo for root access.
