"""PyInstaller entry point.

Not `python -m ultrastar_wingman`: PyInstaller runs its entry script as `__main__`
with no package, so the relative imports in `ultrastar_wingman/__main__.py` would fail.
"""

from ultrastar_wingman.__main__ import main

main()
