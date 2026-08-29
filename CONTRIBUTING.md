# Contribution Guidelines

Thank you for considering contributing to this project! By contributing, you help make this project better for everyone. Please take a moment to review these guidelines to ensure a smooth contribution process.

Areas where help is especially valuable:
- Export optimisations
- Native screen recording for Linux
- Wallpaper submissions
- Extensions (device frames, click effects, render hooks — see [EXTENSIONS.md](./EXTENSIONS.md))

## How to Contribute

1. **Fork the Repository**
   - Click the "Fork" button at the top right of this repository to create your own copy.

2. **Clone Your Fork**
   - Clone your forked repository to your local machine:
     ```bash
     git clone https://github.com/your-username/Mo Rec.git
     ```

3. **Create a New Branch**
   - Create a branch for your feature or bug fix:
     ```bash
     git checkout -b feature/your-feature-name
     ```

4. **Make Changes**
   - Make your changes.

5. **Test Your Changes**
   - Test your changes thoroughly to ensure they work as expected and do not break existing functionality.

6. **Commit Your Changes**
   - Commit your changes with a clear and concise commit message:
     ```bash
     git add .
     git commit -m "Add a brief description of your changes"
     ```

7. **Push Your Changes**
   - Push your branch to your forked repository:
     ```bash
     git push origin feature/your-feature-name
     ```

8. **Open a Pull Request**
   - Go to the original repository and open a pull request from your branch. Provide a clear description of your changes and the problem they solve.

## Reporting Issues

If you encounter a bug or have a feature request, please open an issue in the [Issues](https://github.com/morecorg/Mo Rec/issues) section of this repository. Provide as much detail as possible to help us address the issue effectively.

## Style Guide

- Write clear, concise, and descriptive commit messages.
- Include comments where necessary to explain complex code.

## Testing

Run the full suite with `npm test` (vitest). Tests default to a Node environment; DOM-dependent tests opt in per file with a `// @vitest-environment jsdom` docblock at the top.

Shared harnesses:
- `src/test/electronApiMock.ts` — configurable `window.electronAPI` factory for hook and component tests.
- `src/test/renderWithProviders.tsx` — renders components wrapped in the providers they expect (I18n).
- `electron/test/ipcRegistry.ts` — mounts `electron/ipc/register/*` modules with a mocked `electron` module and invokes handlers by channel name (see `register/project.test.ts` for the established pattern).

When fixing a bug, add a test that reproduces it first. New IPC handlers and user-facing features should ship with handler-level or component-level tests.

## License

By contributing to this project, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

Thank you for your contributions!
