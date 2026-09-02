# Integrations

This section is for people building something around Wingman: a Discord bot, a
stream overlay, a bulk importer. It assumes you know HTTP and JSON, and that you
can read an OpenAPI schema.

Everything here describes what Wingman offers to programs outside it. It does
not describe how Wingman is built, and it is not a tour of the source code. If
you are here to run a party rather than to write code, the rest of the site is
what you want.

The section covers the REST API and the schema that defines it. It covers how a
script authenticates, and what it is then allowed to do. It covers the live
event socket an overlay listens to, and the files Wingman keeps on disk.
