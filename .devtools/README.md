# devtools

Variocube developer tools

## Usage

The code in this repository is intended to be installed into variocube projects by calling `devtools.sh init` in the
project root. This will create a `.devtools` directory in the project root and copy the contents of this repository
into it. The `.devtools` directory, its configuration file `.vc` and the created symlinks should be checked in.

If you want to install directly from this repository just run the following command in the root of your project:

```bash
wget https://raw.githubusercontent.com/variocube/devtools/master/devtools.sh
chmod +x devtools.sh
./devtools.sh init
```

### Upgrading devtools

If a user wants to upgrade devtools, he can call `devtools.sh upgrade` in the project root. This will pull the latest
version into the `.devtools` directory and overwrite the symlinks.

## Configuration

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

You can use the provided configuration or if needed, create a project-specific configuration that
extends the provided configuration.

#### Extend the provided configuration

Create a `dprint.json` file that extends the provided configuration

```json
{
  "extends": ".devtools/config/dprint.json"
}
```

Add it to git and commit:

```shell
git add dprint.json
git commit -m "chore: add dprint.json that extends devtools"
```

#### Configure IntelliJ

Install the `dprint` plugin for IntelliJ and enable it in settings.

Add and commit the config files created for the `dprint` plugin in the `.idea` directory. 
