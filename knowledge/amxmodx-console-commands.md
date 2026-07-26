# Comandos de console no AMX Mod X

Fontes oficiais verificadas em 25 de julho de 2026.

`register_clcmd` registra um callback para comandos executados pelo console do
cliente. `register_srvcmd` registra um callback para comandos executados pelo
console do servidor. `register_concmd` aceita comandos originados tanto do
cliente quanto do servidor. Nessas funções, `flags` define os privilégios
administrativos exigidos e o retorno `0` indica falha no registro.

`server_cmd` coloca um comando na fila do console do servidor para execução no
próximo frame. A documentação alerta que entradas controladas pelo cliente,
inclusive nomes de jogadores, precisam ser sanitizadas antes de chegar a essa
função para evitar command injection. `server_exec` força a execução imediata
da fila criada por `server_cmd`.

Fontes:

- https://amxmodx.org/api/amxmodx/register_clcmd
- https://www.amxmodx.org/api/amxmodx/register_srvcmd
- https://amxmodx.org/api/amxmodx/register_concmd
- https://www.amxmodx.org/api/amxmodx/server_cmd
- https://www.amxmodx.org/api/amxmodx/server_exec
