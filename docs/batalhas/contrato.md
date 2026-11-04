# Contrato de batalhas

> **Status:** rascunho v0.1. Este documento define como sistemas de batalha se encaixam no motor. O núcleo de batalha descrito aqui **ainda não foi implementado**. Ele será escrito junto com um módulo de regras mínimo ("toy") e com os testes de contrato, depois da revisão deste texto.

## 1. Objetivo

O motor não tem um sistema de batalha. Ele oferece **o palco**: encontro, arena, câmera, apresentação, o laço da luta e a integração com mapa e save. Cada campanha traz **as regras**: atributos, fórmulas, quem age quando, ações, IA e interface de comando.

É o mesmo princípio dos mapas: o motor sabe montar objetos a partir de prefabs, mas não sabe o que é uma estalagem. Aqui, o motor sabe conduzir uma batalha, mas não sabe o que é "fraqueza", "escudo" ou "barra de ATB".

Um contrato só prova que é genérico quando atende sistemas diferentes. Por isso a regra de ouro é esta: **se um novo módulo de regras exigir mudar o núcleo, o contrato precisa ser revisto**, não contornado.

## 2. Escopo

**Dentro:** batalhas baseadas em **ações discretas**. Alguém age, a ação é resolvida, repete. Isso cobre:

- por turno (rodadas, ordem por velocidade)
- ATB / barra de tempo (o tempo passa e quem enche a barra age)
- linha do tempo / CTB (cada ação custa tempo e define a próxima vez)
- variações: ações simultâneas declaradas antes, turnos por lado etc.

**Fora (por enquanto):** combate em **tempo real**, que exige colisão, hitboxes e input contínuo, sem "vez" de ninguém. Se um dia vier, será um contrato irmão. Este contrato não deve ser esticado para cobri-lo.

## 3. Decisões tomadas

| Questão | Decisão |
| --- | --- |
| Batalha em tela separada ou no próprio mapa? | **As duas.** A arena é só um lugar com posições de combatentes; a lógica não sabe qual está em uso. A primeira campanha usa arena separada. |
| Tempo real? | **Fora** deste contrato (ver §2). O agendador recebe a passagem do tempo, o que basta para ATB. |
| Mais de um sistema por campanha? | **Sim.** Cada encontro diz qual módulo de regras usa; a campanha registra quantos quiser. |
| Idioma | Documento em português; nomes no código em inglês, como no resto do motor. |

## 4. Glossário

- **Encontro (encounter):** a definição de uma luta: quem são os inimigos, qual arena, qual módulo de regras, música, se dá para fugir, scripts de início e fim.
- **Módulo de regras (rules):** o código da campanha que implementa as interfaces da §7.
- **Batalha (battle):** uma luta em andamento. É o objeto que o motor cria e entrega ao módulo de regras.
- **Lado (side):** um grupo de combatentes aliados entre si (ex.: `party`, `enemies`). Pode haver mais de dois.
- **Combatente (combatant):** um participante. Tem recursos, atributos, status e um controlador.
- **Recurso (resource):** valor que sobe e desce dentro de um intervalo (HP, MP, escudo, barra de tempo…). Declarado pela campanha; o motor não conhece nenhum de antemão.
- **Atributo (stat):** número usado pelas fórmulas (força, velocidade…), com modificadores.
- **Status:** efeito com duração (veneno, atordoado…), definido pela campanha.
- **Ação (action):** algo que um combatente faz. Tem custo, alvos e uma lista de efeitos.
- **Efeito (effect):** a menor mudança de estado (causar dano, curar, aplicar status, mover na linha do tempo…). Todo efeito passa pelo **pipeline** do motor.
- **Controlador (controller):** quem decide a ação de um combatente: jogador (menu), IA ou replay.

## 5. Quem faz o quê

| Motor (núcleo) | Campanha (módulo de regras) |
| --- | --- |
| Iniciar o encontro, a transição e a volta ao mapa | Definir quando a batalha termina e o resultado |
| Montar a arena e posicionar os combatentes | Declarar recursos, atributos e status |
| Câmera de batalha, animações de sprite, números flutuantes, efeitos visuais e sonoros | Fórmulas (dano, acerto, crítico, ordem) |
| O laço da batalha (§6) e o pipeline de efeitos | O agendador: quem age e quando |
| RNG com semente, registro (log) e eventos | Ações e handlers de efeito |
| Widgets de interface (painéis, listas, barras, alvos) | O menu de comando e o que ele mostra |
| Integração com save, flags e scripts de evento | IA dos inimigos |
| Entregar o resultado ao jogo | Recompensas (XP, itens…) como dados no resultado |

## 6. Ciclo de vida

```
encontro disparado (mapa, script ou código)
  └─ motor: carrega módulo de regras, cria Battle, monta arena, transição de entrada
     └─ rules.setup(battle)                  cria combatentes, estado inicial
     └─ script onStart do encontro (opcional)
     └─ LAÇO
        ├─ scheduler.advance(battle, dt)     o tempo passa (ATB enche barras; por turno ignora)
        ├─ actor = scheduler.next(battle)    quem age agora? (null = ninguém ainda)
        ├─ decision = controller.choose(...) menu do jogador ou IA (pode ser assíncrono)
        ├─ motor: resolve a ação
        │   ├─ rules.canPay / pay            custo
        │   ├─ apresentação de início        animação, câmera, som
        │   ├─ para cada efeito → pipeline   before → handler → after (§8)
        │   └─ apresentação de fim
        ├─ scheduler.onActionDone(...)       atualiza ordem / barras / linha do tempo
        ├─ status: rules.tickStatuses(...)   quando a campanha quiser
        └─ end = rules.checkEnd(battle)      null = continua; senão sai do laço
     └─ script onEnd do encontro (opcional)
     └─ motor: transição de saída, aplica BattleResult (§11), volta ao mapa
```

Regras do laço:

- O motor **nunca** decide sozinho quem age, o que uma ação faz ou quando a batalha termina.
- O módulo **nunca** avança o laço por conta própria. Ele responde às perguntas do motor.
- O laço avança no tempo do jogo (`dt` do motor), e não em `setTimeout`. Isso permite pausar, acelerar e testar quadro a quadro.

## 7. Interfaces

As formas abaixo são o contrato. No código elas virão como JSDoc, para o editor autocompletar.

### 7.1 Módulo de regras

```js
/** @type {BattleRules} */
export default {
  id: 'classic-turns',          // nome usado pelos encontros
  version: 1,                   // versão do contrato que este módulo implementa

  resources: { hp: { min: 0 }, mp: { min: 0 } },   // declarados pela campanha
  stats: ['attack', 'defense', 'speed'],

  setup(battle, encounter) {},                     // cria combatentes, estado inicial
  createCombatant(def, side, battle) {},           // dado (§10) → combatente em execução
  scheduler: { /* §7.2 */ },
  effects: { damage(ctx) {}, heal(ctx) {} },       // handlers de efeito (§8)
  canPay(actor, action, battle) {},                // custo
  pay(actor, action, battle) {},
  checkEnd(battle) {},                             // null | { outcome, ... } (§11)
  tickStatuses(battle, moment) {},                 // opcional: 'turnStart' | 'turnEnd' | 'round'
  ai: { aggressive(battle, actor) {} },            // controladores de IA por nome (§7.4)
  ui: { /* §7.5 */ },
};
```

### 7.2 Agendador

```js
scheduler: {
  init(battle) {},                    // estado inicial (ordem, barras…)
  advance(battle, dt) {},             // o tempo passou; por turno pode ignorar
  next(battle) { return actorOrNull },// quem age agora
  onActionDone(battle, actor, action, results) {},
  preview(battle, n) { return [] },   // opcional: próximos n atores, para a interface
}
```

Exemplos de implementação (em módulos de campanha, nunca no núcleo):

- **por turno:** `next` devolve o próximo da ordem por velocidade da rodada e ignora `advance`
- **ATB:** `advance` enche barras; `next` devolve quem encheu primeiro
- **linha do tempo:** `onActionDone` reposiciona o ator conforme o custo da ação

### 7.3 Combatente (em execução)

O motor cria o objeto e o módulo preenche o conteúdo:

```js
{
  id, name, side,                 // side: 'party' | 'enemies' | ...
  sheet,                          // sprite (cast:<key> ou arquivo, como nos mapas)
  res: { hp: { value, max } },    // recursos declarados pela campanha
  stat(name),                     // valor final = base + modificadores
  addModifier(stat, { add, mul, until }),
  statuses: [],                   // { id, turns, data }
  actions: [],                    // ids de ações disponíveis
  controller,                     // 'player' | nome de IA | objeto controlador
  alive,                          // derivado pela campanha (ex.: hp > 0)
  data: {},                       // espaço livre da campanha
}
```

### 7.4 Controlador

```js
{ choose(battle, actor) { return Promise<{ action, targets }> } }
```

O jogador, a IA e um replay gravado implementam o mesmo contrato. O motor não diferencia; ele só aguarda a decisão.

### 7.5 Interface de batalha

A campanha monta o menu de comando com os **widgets do motor** (painel, lista, barras de recurso, seletor de alvo, ordem de turno), e não com DOM próprio. Assim o visual fica consistente com o resto do jogo.

```js
ui: {
  commandMenu(battle, actor) { return Promise<{ action, targets }> },  // usado pelo controlador 'player'
  hud(battle) {},                    // o que aparece permanentemente (barras, ordem)
}
```

## 8. Pipeline de efeitos

Toda mudança de estado passa por aqui, sem exceção:

```
battle.apply(effect, ctx)
  ├─ hooks "before"   (campanha e scripts podem alterar ou cancelar)
  ├─ handler          rules.effects[effect.type](ctx) → resultado
  ├─ hooks "after"    (reações, contra-ataques, conquistas…)
  ├─ registro (log)   para replay, depuração e testes
  └─ evento           'effect' → apresentação (números, som, flash)
```

O `ctx` traz `battle`, `source`, `target`, `action`, `effect`, `rng` e `results` (dos efeitos anteriores da mesma ação).

Um efeito pode gerar outros efeitos (ex.: dano que aplica status), sempre via `battle.apply`, nunca alterando o combatente direto.

## 9. O que o motor oferece ao módulo (`battle`)

- `battle.combatants`, `battle.sides`, `battle.side(id)`, `battle.alive(side)`
- `battle.rng`: gerador com semente. **É a única fonte de aleatoriedade permitida.**
- `battle.apply(effect, ctx)`: o pipeline (§8)
- `battle.on(evento, fn)` / `battle.emit(evento, dados)`: §9.1
- `battle.present(passo)`: animações e câmera, devolve Promise; o laço espera
- `battle.runScript(script)`: os mesmos scripts de evento dos mapas (falas no meio da luta, cutscenes de chefe)
- `battle.flags`: leitura das flags da história (escrita só via resultado, §11)
- `battle.round`, `battle.time`, `battle.log`

### 9.1 Eventos emitidos

`start`, `turnStart`, `decision`, `actionStart`, `effect`, `actionEnd`, `turnEnd`, `statusApplied`, `statusExpired`, `defeated`, `end`.

Som, câmera, interface e scripts reagem a eventos. O módulo de regras não precisa conhecer nenhum deles.

## 10. Dados

### 10.1 Inimigos e grupos (JSON da campanha)

```json
{
  "enemies": {
    "slime": { "name": "Slime", "sheet": "sprites/slime.json", "res": { "hp": 30 }, "stats": { "attack": 5, "speed": 3 }, "actions": ["tackle"], "ai": "aggressive" }
  },
  "groups": { "meadow-1": ["slime", "slime"] },
  "actions": {
    "tackle": { "name": "Tackle", "target": { "side": "opponent", "count": 1 }, "effects": [{ "type": "damage", "power": 8 }], "presentation": { "anim": "lunge", "sfx": "hit" } }
  }
}
```

Os campos dentro de `res`, `stats`, `effects` e `presentation` são definidos pela campanha. O motor só garante a estrutura e repassa o resto.

### 10.2 Encontro

```json
{
  "rules": "classic-turns",
  "group": "meadow-1",
  "arena": { "map": "arena-meadow" },
  "music": "battle",
  "canEscape": true,
  "seed": null,
  "onStart": "@bossTaunt",
  "onEnd": null
}
```

`arena` aceita `{ "map": "<id>" }` (tela separada) ou `{ "inline": true, "radius": 6 }` (no próprio mapa, ao redor do ponto do encontro).

### 10.3 No mapa (Tiled ou código)

Um objeto `encounter` no Tiled, com as propriedades acima, ou um comando de evento `{ "do": "battle", "encounter": "meadow-1" }`. O mapa não sabe como a luta funciona; só aponta para ela.

## 11. Resultado

```js
{
  outcome: 'victory' | 'defeat' | 'escape' | string,  // campanhas podem ter outros
  rewards: { xp: 0, items: [] },                       // forma livre da campanha
  flags: { set: [], clear: [] },                       // único canal de escrita em flags
  party: { /* estado que persiste: hp restante etc. */ },
}
```

O motor aplica o resultado: flags, save e volta ao mapa (ou game over, conforme o encontro), e emite `end`. O que fazer com `rewards` e `party` é decisão da campanha, num gancho `onResult` dela.

**v1:** não há save durante a batalha. Salva-se antes (o mapa) e depois (o resultado).

## 12. Garantias e proibições

O módulo de regras **deve**:

- usar **apenas** `battle.rng` para aleatoriedade. Mesma semente e mesmas decisões dão o mesmo resultado.
- alterar estado **apenas** via `battle.apply` (pipeline).
- terminar: `checkEnd` deve eventualmente devolver um resultado (os testes de contrato verificam).
- tratar combatentes derrotados (não escolhê-los como atores, a menos que a regra queira).

O módulo de regras **não deve**:

- mexer na cena 3D, na câmera ou no DOM diretamente (usar `present` e os widgets)
- usar `Math.random`, `Date.now`, `setTimeout` ou relógio próprio
- escrever flags ou save fora do resultado (§11)
- depender de outro módulo de regras

O motor **garante**:

- chamar as interfaces na ordem do §6
- nunca alterar o estado de um combatente por conta própria
- que `present()` e scripts não mudem o resultado da batalha, só a apresentação

## 13. Registro e organização

```js
game.battles.register(rules)        // a campanha registra quantos módulos quiser
```

```
campaigns/<campanha>/
  battle/
    rules/<id>.js          módulos de regras
    data/enemies.json      inimigos, grupos, ações
    ui/                    menu de comando, HUD
  maps/                    mapas da campanha (Tiled)
```

O motor (`src/engine/battle/`) não contém nenhum módulo de regras "oficial". O módulo toy fica em `tests/` e existe só para provar o contrato.

## 14. Testes de contrato (a implementar)

Uma bateria que qualquer módulo de campanha roda contra o próprio código:

- **termina:** com controladores aleatórios, toda batalha acaba em até N passos
- **determinismo:** mesma semente e mesmas decisões dão um log idêntico
- **pipeline:** nenhum recurso muda sem um registro de efeito correspondente
- **sem efeitos colaterais:** o módulo não toca em cena, DOM, `Math.random` ou relógio
- **resultado válido:** `outcome` presente; flags só via `flags.set` / `flags.clear`
- **derrotados:** nunca escolhidos como atores quando a regra diz que não agem

## 15. Versionamento

- O contrato tem versão (`version` no módulo, §7.1). Mudança incompatível aumenta a versão, e o motor recusa módulos de versão diferente com uma mensagem clara.
- Mudanças passam por este documento **antes** do código.

## 16. Em aberto

- Formato exato dos passos de `present()` (reaproveitar comandos de evento ou um formato próprio de batalha?)
- Batalha inline: o que acontece com NPCs e gatilhos do mapa durante a luta (pausar tudo ou só a área?)
- Quantos lados no máximo a interface do motor suporta bem (2 é o caso comum; 3 ou mais para "monstros brigando entre si")
- Fuga: regra só da campanha, ou o motor oferece um efeito padrão `escape`?
- Persistência entre batalhas (HP da party): campo `party` do resultado ou estado da campanha fora da batalha?
