/*:
 * @plugindesc Procedural Generation - Map
 * @author Lucas Martins
 * 
 * @help
 * Comando de Plugin
 * 
 * 	ProcGen Generate
 * 
 * O que faz:
 * - Lê o tile em (0,0) como PAREDE (camada A).
 * - Lê o tile em (1,0) como CHÃO (camada A).
 * - Preenche TODO o mapa atual com PAREDE.
 * - Cria UMA sala retangular no centro com CHÃO.
 * - Atualiza o tilemap para você ver na hora.
 * 
 *	ProcGen GeneratePlace
 * 
 * O que faz:
 * Após gerar o mapa, posiciona o player em uma posição (x, y)
 * 
 */

(function() {
	// --- CONSTANTS ---
	const PLUGIN_NAME = 'ProcGen';

	// --- HELPERS - Mapas ---
	function getTileIndex(width, height, x, y, z) {
		return (z * width * height) + (y * width) + x;
	}

	function setTile(layer, x, y, tileId) {
		const width = $gameMap.width();
		const height = $gameMap.height();

		if (x < 0 || y < 0 || x >= width || y >= height) return;

		const data = $gameMap.data();
		if (!data) return;

		const index = getTileIndex(width, height, x, y, layer);
		data[index] = tileId;
	}

	function refreshTilemap() {
		const scene = SceneManager._scene;
		
		if (scene && scene._spriteset && scene._spriteset._tilemap) {
			scene._spriteset._tilemap.refresh();
		}

		$gameMap.requestRefresh();
	}

	// --- GERAÇÃO SIMPLES: SALA NO CENTRO
	function generateRooms(shouldPlacePlayer = false) {
		console.log({shouldPlacePlayer});
		if (!$gameMap || !$gameMap.data()) {
			console.warn('[ProcGen] $gameMap não está pronto');
			return;
		}

		const mapWidth = $gameMap.width();
		const mapHeight = $gameMap.height();

		const WALL_ID = $gameMap.tileId(0, 0, 0); // (x, y, layer)
		const FLOOR_ID = $gameMap.tileId(1, 0, 0); // (x, y, layer)

		if (!WALL_ID || !FLOOR_ID || 	WALL_ID === FLOOR_ID) {
			console.warn('[ProcGen] Amostras inválidas de tiles. Verifique se (0, 0) = parede, (1, 0) = chão e layer 0 = A');
			return;
		}

		// Preenche mapa com parede
		for (let y = 0; y < mapHeight; y++) {
			for (let x = 0; x < mapWidth; x++) {
				setTile(0, x, y, WALL_ID);
			}
		}

		// Cria uma sala no centro
		const roomWidth = Math.max(4, Math.floor(mapWidth / 2));
		const roomHeight = Math.max(4, Math.floor(mapHeight / 2));
		const roomX = Math.floor((mapWidth - roomWidth) / 2);
		const roomY = Math.floor((mapHeight - roomHeight) / 2);
		
		for (let y = roomY; y < roomY + roomHeight; y++) {
			for (let x = roomX; x < roomX + roomWidth; x++) {
				setTile(0, x, y, FLOOR_ID);
			}
		}

		// Posiciona o jogador
		if (shouldPlacePlayer) {
			const centerX = Math.floor(roomX + roomWidth / 2);
			const centerY = Math.floor(roomY + roomHeight / 2);

			$gamePlayer.locate(centerX, centerY);
		}

		// Atualiza o desenho do mapa
		refreshTilemap();
	}

	// --- PLUGIN COMMAND ---
	const _pluginCommand = Game_Interpreter.prototype.pluginCommand;
	Game_Interpreter.prototype.pluginCommand = function(command, args) {
		_pluginCommand.call(this, command, args);

		if (command === 'ProcGen') {
			const sub = (args[0] || '').toLowerCase();

			if (sub === 'generate') {
				generateRooms();
			}

			if (sub === 'generateandplaceplayer') {
				generateRooms(true)
			}
		}
	}
})()