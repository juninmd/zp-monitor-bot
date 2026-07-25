# Zombie Plague do server-do-junin

O servidor usa Counter-Strike 1.6 com AMX Mod X e Zombie Plague 5.0. A partida alterna humanos e zumbis. Em uma rodada comum, um ou mais jogadores são infectados; zumbis tentam infectar os humanos restantes e humanos tentam sobreviver até o fim.

Ammo Packs (AP) são a moeda do Zombie Plague. Servem para comprar itens extras. Neste servidor, zumbis mortos podem derrubar Ammo Packs físicos para coleta e há chance de bônus de drop. A IA limita concessões de AP e aplica cooldown para evitar abuso.

Nemesis é uma classe ou modo especial de zumbi, normalmente mais resistente e poderosa. Survivor é uma classe ou modo especial humano, com armamento e resistência superiores. Swarm coloca grupos de humanos e zumbis em confronto sem a conversão normal por infecção. Plague combina ameaças especiais, como Nemesis, com sobreviventes especiais. O conjunto instalado também inclui modos customizados como Assassin, Matrix, DBZ, John Wick, Saitama, Terminator, Survival, Spy e confrontos 1v1.

As classes humanas instaladas incluem classic, doctor, kage, raptor e survivor. As classes zumbis incluem classic, nemesis, overlord, variantes inspiradas em Left 4 Dead (boomer, hunter, smoker, spitter e witch), venom, bruto, burning, fat, leech, light, rage, raptor, skinwalker e slender. A disponibilidade exata pode variar conforme o modo e o mapa.

Itens extras incluem armas e habilidades temáticas, além de utilidades como adrenalina, antídoto, desfibrilador, pipe bomb e bomba de infecção. Antídoto reverte um zumbi para humano quando as regras da rodada permitem. Desfibrilador e respawn dependem do estado do jogador, do modo atual e dos cooldowns.

O servidor possui comandos administrativos `zp_respawn <alvo>` e `zp_give_ammo <alvo> <quantidade>`. O bot nunca deve permitir que um jogador escolha outro alvo: ferramentas acionadas pelo chat do jogo ficam vinculadas ao próprio SteamID/nome do solicitante.

O plugin `zp50_telemetry` expõe `zp_telemetry_snapshot` e `zp_telemetry_positions` via RCON. O snapshot contém fase e modo da rodada, tempo, contagem de zumbis e humanos e eventos recentes. As posições alimentam um radar operacional; não são um minimapa calibrado e usam escala automática do quadro atual.

Para falar com a IA dentro do jogo, use `!ia`, `!bot` ou `!admin` seguido da pergunta. Pedidos administrativos são limitados por cooldown e auditados no Telegram. No Telegram, `/status` mostra monitoria; `/ask` consulta esta base com pgvector; `/rcon` aceita apenas comandos previamente permitidos; `/map` troca o mapa com auditoria.
