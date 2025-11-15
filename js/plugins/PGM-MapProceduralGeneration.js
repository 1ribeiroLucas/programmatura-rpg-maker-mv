/*:
 * @plugindesc [MV] Dungeon procedural (salas + corredores) com amostragem de tiles e "próximo andar" no mesmo mapa. v1.1
 * @author ChatGPT
 *
 * @param RoomsCount
 * @type number
 * @min 1
 * @default 8
 * @desc Quantidade de salas a tentar criar.
 *
 * @param MinRoomSize
 * @type number
 * @min 3
 * @default 4
 * @desc Tamanho mínimo (lado) das salas.
 *
 * @param MaxRoomSize
 * @type number
 * @min 3
 * @default 10
 * @desc Tamanho máximo (lado) das salas.
 *
 * @param WallSampleX
 * @type number
 * @min 0
 * @default 0
 * @desc X de um tile pintado como PAREDE (impassável) no mapa.
 *
 * @param WallSampleY
 * @type number
 * @min 0
 * @default 0
 * @desc Y de um tile pintado como PAREDE (impassável) no mapa.
 *
 * @param FloorSampleX
 * @type number
 * @min 0
 * @default 1
 * @desc X de um tile pintado como CHÃO (passável) no mapa.
 *
 * @param FloorSampleY
 * @type number
 * @min 0
 * @default 0
 * @desc Y de um tile pintado como CHÃO (passável) no mapa.
 *
 * @param ExitSampleX
 * @type number
 * @min 0
 * @default 2
 * @desc X de um tile pintado como SAÍDA (escada/porta). Use um tile distinto de parede/chão.
 *
 * @param ExitSampleY
 * @type number
 * @min 0
 * @default 0
 * @desc Y de um tile pintado como SAÍDA (escada/porta).
 *
 * @param PlaceExit
 * @type boolean
 * @on Sim
 * @off Não
 * @default true
 * @desc Se true, coloca um tile de SAÍDA no andar (normalmente na sala mais distante).
 *
 * @param Seed
 * @type number
 * @min 0
 * @default 0
 * @desc (Opcional) Seed determinística (>0) para layouts reprodutíveis. 0 = aleatório.
 *
 * @help
 * MV ONLY. Comandos de Plugin:
 *
 *   ProcGen Generate
 *     -> Gera no mapa atual (não move o player).
 *
 *   ProcGen GeneratePlace
 *     -> Gera e move o player para o centro da 1ª sala (sem transfer).
 *
 *   ProcGen NextFloor
 *     -> Força ir para o "próximo andar" (regenera e recoloca o jogador).
 *
 * Como usar:
 * 1) Pinte três amostras no mapa:
 *    - (WallSampleX,WallSampleY) = PAREDE (❌)
 *    - (FloorSampleX,FloorSampleY) = CHÃO (⭕)
 *    - (ExitSampleX,ExitSampleY) = SAÍDA (um tile de escada/porta)
 * 2) Rode "ProcGen GeneratePlace" via evento para criar o 1º andar.
 * 3) Ao pisar na SAÍDA, o plugin regenera a dungeon no mesmo mapa e realoca o player.
 *
 * Dicas:
 * - Se usar um evento Autorun p/ gerar, lembre-se de desligá-lo (Self Switch A).
 * - Certifique-se que CHÃO é passável no tileset.
 */
(function() {
  'use strict';

  const PLUGIN_NAME = 'PGM-MapProceduralGeneration';
  const params = PluginManager.parameters(PLUGIN_NAME);

  const ROOMS_COUNT = Number(params['RoomsCount'] || 8);
  const MIN_SIZE    = Number(params['MinRoomSize'] || 4);
  const MAX_SIZE    = Number(params['MaxRoomSize'] || 10);

  const WALL_SX  = Number(params['WallSampleX'] || 0);
  const WALL_SY  = Number(params['WallSampleY'] || 0);
  const FLOOR_SX = Number(params['FloorSampleX'] || 1);
  const FLOOR_SY = Number(params['FloorSampleY'] || 0);

  const EXIT_SX  = Number(params['ExitSampleX'] || 2);
  const EXIT_SY  = Number(params['ExitSampleY'] || 0);
  const PLACE_EXIT = String(params['PlaceExit'] || 'true') === 'true';

  const SEED = Number(params['Seed'] || 0);

  // ---------------- RNG com seed opcional ----------------
  let _rngState = 0;
  function srand(seed) {
    _rngState = (seed >>> 0) || (Math.random() * 0xffffffff) >>> 0;
    if (_rngState === 0) _rngState = 0xA2F1C3D5;
  }
  function srandom() {
    _rngState = (1664525 * _rngState + 1013904223) >>> 0;
    return _rngState / 0x100000000;
  }
  function randInt(min, max) {
    const r = (SEED > 0) ? srandom() : Math.random();
    return Math.floor(r * (max - min + 1)) + min;
  }

  // ========== Utilitários de mapa baseados em $gameMap =========
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function mapIndex(width, height, x, y, z) {
    return (z * width * height) + (y * width) + x;
  }

  function getTile(layer, x, y) {
    const w = $gameMap.width();
    const h = $gameMap.height();

    if (x < 0 || y < 0 || x >= w || y >= h) {
      return 0;
    }

    const data = $gameMap.data();

    if (!data) {
      return 0;
    }

    const i = mapIndex(w, h, x, y, layer);

    return data[i] || 0;
  }

  function setTile(layer, x, y, tileId) {
    const w = $gameMap.width();
    const h = $gameMap.height();

    if (x < 0 || y < 0 || x >= w || y >= h) {
      return;
    }

    const data = $gameMap.data();

    if (!data) {
      return;
    }

    const i = mapIndex(w, h, x, y, layer);

    data[i] = tileId;
  }

  function sampleAnyLayer(x, y) {
    for (let z = 3; z >= 0; z--) {
      const id = getTile(z, x, y);

      if (id) {
        return { tileId: id, layer: z }
      }
    }

    return { tileId: 0, layer: 0 }
  }

  function refreshMap() {
    const scene = SceneManager._scene;

    if (scene && scene._spriteset && scene._spriteset._tilemap) {
      scene._spriteset._tilemap.refresh();
    }

    $gameMap.requestRefresh();
  }

  // ---------------- Sala ----------------
  function Room(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.cx = Math.floor(x + w / 2);
    this.cy = Math.floor(y + h / 2);
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function carveRoom(room, tileFloor) {
    for (let yy = room.y; yy < room.y + room.h; yy++) {
      for (let xx = room.x; xx < room.x + room.w; xx++) {
        setTile(0, xx, yy, tileFloor);
      }
    }
  }

  function carveH(x1, x2, y, tileFloor) {
    const a = Math.min(x1, x2), b = Math.max(x1, x2);
    for (let x = a; x <= b; x++) setTile(0, x, y, tileFloor);
  }

  function carveV(y1, y2, x, tileFloor) {
    const a = Math.min(y1, y2), b = Math.max(y1, y2);
    for (let y = a; y <= b; y++) setTile(0, x, y, tileFloor);
  }
  
  function carveCorridor(A, B, tileFloor) {
    if (randInt(0,1) === 0) {
      carveH(A.cx, B.cx, A.cy, tileFloor);
      carveV(A.cy, B.cy, B.cx, tileFloor);
    } else {
      carveV(A.cy, B.cy, A.cx, tileFloor);
      carveH(A.cx, B.cx, B.cy, tileFloor);
    }
  }

  // ---------------- Refresh visual ----------------
  function refreshTilemap() {
    const scene = SceneManager._scene;
    if (scene && scene._spriteset && scene._spriteset._tilemap) {
      scene._spriteset._tilemap.refresh();
    }
    $gameMap.requestRefresh();
  }

  // ---------------- Estado da saída ----------------
  // Guardamos o tileId de saída e a coordenada em que foi colocado.
  // Assim, checamos "player está no X,Y da saída?" para avançar.
  function clearExitState() {
    $gameMap._procgenExitX = null;
    $gameMap._procgenExitY = null;
    $gameMap._procgenExitTile = null;
    $gameMap._procgenAdvancing = false;
  }

  // ---------------- Núcleo: gerar no mapa atual ----------------
  function generateDungeonOnCurrentMap(options) {
    options = options || {};
    if (!$dataMap) return { rooms: [], start: null, ok:false };

    if (SEED > 0) srand(SEED);

    const width  = $dataMap.width;
    const height = $dataMap.height;

    // 1) Amostragem
    const tileWall  = getTile(0, clamp(WALL_SX,0,width-1),  clamp(WALL_SY,0,height-1));
    const tileFloor = getTile(0, clamp(FLOOR_SX,0,width-1), clamp(FLOOR_SY,0,height-1));
    const tileExit  = getTile(0, clamp(EXIT_SX,0,width-1),  clamp(EXIT_SY,0,height-1));

    if (!tileWall || !tileFloor || tileWall === tileFloor) {
      console.warn('[ProcGen] Amostra inválida de parede/chão.');
      return { rooms: [], start: null, ok:false };
    }
    if (PLACE_EXIT && (!tileExit || tileExit === tileWall || tileExit === tileFloor)) {
      console.warn('[ProcGen] Recomenda-se um tile de SAÍDA distinto (ExitSample).');
      // ainda assim permitimos continuar; se inválido, não colocamos saída
    }

    // 2) Preencher tudo com parede
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) setTile(0, x, y, tileWall);
    }

    // 3) Salas
    const rooms = [];
    for (let i = 0; i < ROOMS_COUNT; i++) {
      const w = clamp(randInt(MIN_SIZE, MAX_SIZE), 3, width-2);
      const h = clamp(randInt(MIN_SIZE, MAX_SIZE), 3, height-2);
      const x = clamp(randInt(1, width - w - 2), 1, Math.max(1, width - w - 2));
      const y = clamp(randInt(1, height - h - 2), 1, Math.max(1, height - h - 2));
      const r = new Room(x, y, w, h);
      let collide = false;
      for (let k = 0; k < rooms.length; k++) if (intersects(r, rooms[k])) { collide = true; break; }
      if (!collide) {
        carveRoom(r, tileFloor);
        if (rooms.length > 0) carveCorridor(rooms[rooms.length-1], r, tileFloor);
        rooms.push(r);
      }
    }

    // 4) Ponto inicial
    const start = rooms.length ? rooms[0] : null;

    // 5) Saída (na sala mais distante da inicial, ou última sala criada)
    clearExitState();
    if (PLACE_EXIT && rooms.length >= 2 && tileExit && tileExit !== tileWall && tileExit !== tileFloor) {
      let exitRoom = rooms[rooms.length - 1];
      if (start) {
        // opcional: escolher a sala mais distante da start (métrica Manhattan)
        let best = exitRoom, bestD = 0;
        for (let i = 1; i < rooms.length; i++) {
          const r = rooms[i];
          const d = Math.abs(r.cx - start.cx) + Math.abs(r.cy - start.cy);
          if (d > bestD) { bestD = d; best = r; }
        }
        exitRoom = best;
      }
      setTile(0, exitRoom.cx, exitRoom.cy, tileExit);
      $gameMap._procgenExitX = exitRoom.cx;
      $gameMap._procgenExitY = exitRoom.cy;
      $gameMap._procgenExitTile = tileExit;
    }

    refreshTilemap();

    // 6) (Opcional) posicionar player
    if (options.placePlayer && start) {
      $gamePlayer.locate(start.cx, start.cy);
      refreshTilemap();
    }

    return { rooms, start, ok:true };
  }

  // ---------------- Passar para o próximo andar ----------------
  function nextFloor() {
    if ($gameMap._procgenAdvancing) return;
    $gameMap._procgenAdvancing = true;

    // Regerar e recolocar o player no novo start
    const res = generateDungeonOnCurrentMap({ placePlayer: true });
    // Limpa para evitar re-disparo imediato
    clearExitState();

    // pequena proteção
    setTimeout(() => { $gameMap._procgenAdvancing = false; }, 0);
  }

  // ---------------- Hook de update para detectar "pisou na saída" ----------------
  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() {
    _Scene_Map_update.call(this);
    if ($gameMap && $dataMap) {
      const ex = $gameMap._procgenExitX;
      const ey = $gameMap._procgenExitY;
      
      if (ex !== null && ey !== null) {
        if ($gamePlayer.x === ex && $gamePlayer.y === ey && !$gameTemp._procgenNextFloor) {
          $gameTemp._procgenNextFloor = true;

          $gamePlayer.reserveTransfer($gameMap.mapId(), $gamePlayer.x, $gamePlayer.y, $gamePlayer.direction(), 0)
        }
      }
    }
  };

  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function() {
    _Scene_Map_onMapLoaded.call(this);

    if ($gameTemp && $gameTemp._procgenNextFloor) {
      const res = generateDungeonOnCurrentMap({ placePlayer: true });
      $gameTemp._procgenNextFloor = false;
    }
  }

  // ---------------- Plugin Commands (MV) ----------------
  const _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);
    if (command === 'ProcGen') {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'generate') {
        generateDungeonOnCurrentMap({ placePlayer:false });
      } else if (sub === 'generateplace') {
        generateDungeonOnCurrentMap({ placePlayer:true });
      } else if (sub === 'nextfloor') {
        nextFloor();
      }
    }
  };
})();
