"""Atlas Voice Gateway.

The single backend entry point for the Readdy Atlas Voice Console.

The browser only ever talks to this gateway. The gateway is the only component
that talks to the HAL and TRON Ollama instances.
"""

__version__ = "0.3.0"