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
 *   ProcGen GenerateAndPlacePlayer
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

  // ---------------- Núcleo: gerar no mapa atual ----------------
  function generateDungeonOnCurrentMap(options) {
    options = options || {};

    if (!$gameMap || !$gameMap.data()) {
      console.warn('[ProcGen] $gameMap ainda não está pronto');
      return {
        rooms: [],
        start: null,
        ok: false
      };
    }

    if (SEED > 0) srand(SEED);

    const width = $gameMap.width();
    const height = $gameMap.height();

    const wallPos = { x: clamp(WALL_SX, 0, width - 1), y: clamp(WALL_SY, 0, height - 1) };
    const floorPos = { x: clamp(FLOOR_SX, 0, width - 1), y: clamp(FLOOR_SY, 0, height - 1) };
    const exitPos = { x: clamp(EXIT_SX, 0, width - 1), y: clamp(EXIT_SY, 0, height - 1) };

    const tileWall = getTile(0, wallPos.x, wallPos.y);
    const tileFloor = getTile(0, floorPos.x, floorPos.y);
    const exitSample = sampleAnyLayer(exitPos.x, exitPos.y);
    const tileExit = exitSample.tileId;
    const exitLayer = exitSample.layer;

    if (!tileWall || !tileFloor || tileWall === tileFloor) {
      console.warn('[ProcGen] Amostra inválida de parede/chão. Use tiles do conjunto A em Wall/Floor.');
      return { rooms: [], start: null, ok: false };
    }

    // 1. Preenche tudo com parede (camada 0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setTile(0, x, y, tileWall);
      }
    }

    // 2. Gera salas
    const rooms = [];
    for (let i = 0; i < ROOMS_COUNT; i++) {
      const roomWidth = clamp(randInt(MIN_SIZE, MAX_SIZE), 3, width - 2);
      const roomHeight = clamp(randInt(MIN_SIZE, MAX_SIZE), 3, height - 2);
      const roomX = clamp(randInt(1, width - roomWidth - 2), 1, Math.max(1, width - roomWidth - 2));
      const roomY = clamp(randInt(1, height - roomHeight - 2), 1, Math.max(1, height - roomHeight - 2));
      const room = new Room(roomX, roomY, roomWidth, roomHeight);

      let collide = false;
      
      for (let k = 0; k < rooms.length; k++) {
        if (intersects(room, rooms[k])) {
          collide = true;
          break;
        }
      }

      if (!collide) {
        carveRoom(room, tileFloor);
        if (rooms.length > 0) {
          carveCorridor(rooms[rooms.length - 1], room, tileFloor);
        }
        rooms.push(room);
      }
    }

    const start = rooms.length > 0 ? rooms[0] : null;
    console.log({ start, rooms });

    // 3. Posição da saída (sala mais distante da inicial)
    $gameMap._procgenExitX = null;
    $gameMap._procgenExitY = null;

    if (PLACE_EXIT && rooms.length >= 2 && tileExit && tileExit !== tileWall && tileExit !== tileFloor) {
      let exitRoom = rooms[rooms.length - 1];

      if (start) {
        let best = exitRoom;
        let bestD = 0;

        for (let i = 1; i < rooms.length; i++) {
          const r = rooms[i];
          const d = Math.abs(r.cx - start.cx) + Math.abs(r.cy - start.cy);

          if (d > bestD) {
            bestD = d;
            best = r;
          }
        }

        exitRoom = best;
      }

      // Garante chão por baixo e senha saída na camada correta
      setTile(0, exitRoom.cx, exitRoom.cy, tileFloor);
      setTile(exitLayer, exitRoom.cs, exitRoom.cy, tileExit);

      $gameMap._procgenExitX = exitRoom.cx;
      $gameMap._procgenExitY = exitRoom.cy;
    }

    // 4. Posiciona o player se necessário
    if (options.placePlayer && start) {
      $gamePlayer.locate(start.cx, start.cy);
    }

    refreshMap();

    return {
      rooms,
      start,
      ok: true
    };
  }

  // ========= Avança para o próximo andar ("próximo mapa", mas na verdade é o mesmo mapa) ==========
  function transferToNextFloor() {
    if (!$gameMap) return;
    if ($gameMap._procgenNextFloor) return;

    $gameMap._procgenNextFloor = true;

    // Transfer seguro para o MESMO mapa; a geração acontece no onMapLoaded
    $gamePlayer.reserveTransfer(
      $gameMap.mapId(),
      $gamePlayer.x,
      $gamePlayer.y,
      $gamePlayer.direction(),
      0
    );
  }

  // ---------------- Hook de update para detectar "pisou na saída" ----------------
  const _Scene_Map_update = Scene_Map.prototype.update;

  Scene_Map.prototype.update = function() {
    _Scene_Map_update.call(this);

    if (!$gameMap) return;

    const ex = $gameMap._procgenExitX;
    const ey = $gameMap._procgenExitY;

    if (ex !== null && ey !== null) {
      if ($gamePlayer.x === ex && $gamePlayer.y === ey && !$gameMap._procgenNextFloor) {
        transferToNextFloor();
      }
    }
  };

  // ========== Geração após transfer para próximo andar ==========
  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function() {
    _Scene_Map_onMapLoaded.call(this);

    if ($gameMap && $gameMap._procgenNextFloor) {
      generateDungeonOnCurrentMap({ placePlayer: true });
      $gameMap._procgenNextFloor = false;
    }
  }

  // ---------------- Plugin Commands (MV) ----------------
  const _pluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _pluginCommand.call(this, command, args);

    if (command = 'ProcGen') {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'generate') {
        generateDungeonOnCurrentMap({ placePlayer: false });
      } else if (sub === 'generateandplaceplayer') {
        generateDungeonOnCurrentMap({ placePlayer: true });
      } else if (sub === 'nextfloor') {
        transferToNextFloor();
      }
    }
  }

})();
