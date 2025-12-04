-- Bundled by luabundle {"version":"1.6.0"}
local __bundle_require, __bundle_loaded, __bundle_register, __bundle_modules = (function(superRequire)
	local loadingPlaceholder = {[{}] = true}

	local register
	local modules = {}

	local require
	local loaded = {}

	register = function(name, body)
		if not modules[name] then
			modules[name] = body
		end
	end

	require = function(name)
		local loadedModule = loaded[name]

		if loadedModule then
			if loadedModule == loadingPlaceholder then
				return nil
			end
		else
			if not modules[name] then
				if not superRequire then
					local identifier = type(name) == 'string' and '\"' .. name .. '\"' or tostring(name)
					error('Tried to require ' .. identifier .. ', but no such module has been registered')
				else
					return superRequire(name)
				end
			end

			loaded[name] = loadingPlaceholder
			loadedModule = modules[name](require, loaded, register, modules)
			loaded[name] = loadedModule
		end

		return loadedModule
	end

	return require, loaded, register, modules
end)(nil)
__bundle_register("Global", function(require, _LOADED, __bundle_register, __bundle_modules)
require("TtsLuaAdditions")

local ObjectTemplateLib         = require("ObjectTemplateLib")
local SearchLib                 = require("SearchLib")
local TableLib                  = require("TableLib")
local WebRequestLib             = require("WebRequestLib")

-- this table stores the destination from each player as color -> destination pair
local destinationPerPlayerColor = {}

local playAreaData              = {}
local traitSettingsPerPlayer    = {}
local dicePositionsPerPlayer    = {}
local diceCountPerPlayer        = {}
local fresh                     = true

-------------------------------------------------------------------------------
-- MARK: Constants
-------------------------------------------------------------------------------

local ASSET_HOST_URL            = "https://gvxfokbptelmvvlxbigh.functions.supabase.co/export-all-tts-json/tts-export.json"

-- list of option for players to choose from for their navigation
local NAVIGATE_OPTIONS          = {
  "Astral Zone",
  "Cyber City",
  "Floral Patch",
  "Fairy Oasis",
  "Royal Gate",
  "Canyon Light",
  "Stay",
  "Arcane Abyss"
}

-- global coordinates for the market of Hex Spirits
local MARKET_SPIRIT_POSITIONS   = {
  Vector(0, 1.28, 6.06),
  Vector(5.25, 1.28, 3.03),
  Vector(5.25, 1.28, -3.03),
  Vector(0, 1.28, -6.06),
  Vector(-5.25, 1.28, -3.03),
  Vector(-5.25, 1.28, 3.03)
}

-- the following tables describe the monsters (from 1 to 5)
-- cost that should be filtered for (in the metadata of the Hex Spirits)
local SEAL_TARGET_COST          = { 1, 3, 5, 7, 9 }

-- how many spirits should get stolen at once?
local SEAL_PER_PURGE            = { 2, 2, 2, 1, 2 }

-- how many spirits can this monster seal in total?
local MAX_SEALED_SPIRITS        = { 999, 999, 999, 4, 4 }

local DICE_OPTIONS              = {
  Archer = {
    ["0"] = "0x Basic Attack",
    ["1"] = "0x Basic Attack",
    ["2"] = "1x Basic Attack",
    ["3"] = "2x Basic Attack",
    ["4"] = "3x Critical Attack",
    ["5"] = "6x Critical Attack",
    ["6"] = "1x Arcane Attack, 4x Critical Attack",
    ["7"] = "2x Arcane Attack, 2x Critical Attack",
    ["8"] = "4x Arcane Attack",
    ["9"] = "4x Arcane Attack"
  },
  Sorcerer = {
    ["0"] = "0x Basic Attack",
    ["1"] = "1x Basic Attack x Runes",
    ["2"] = "1x Basic Attack x Runes",
    ["3"] = "1x Critical Attack x Runes",
    ["4"] = "1x Critical Attack x Runes",
    ["5"] = "2x Critical Attack x Runes",
    ["6"] = "1x Exalted Attack x Runes, 1x Basic Attack x Runes",
    ["7"] = "1x Arcane Attack x Runes",
    ["8"] = "1x Arcane Attack x Runes",
    ["9"] = "1x Arcane Attack x Runes, 1x Exalted Attack x Runes"
  },
  Swordsman = {
    ["0"] = "0x Basic Attack",
    ["1"] = "1x Basic Attack",
    ["2"] = "2x Basic Attack",
    ["3"] = "4x Basic Attack",
    ["4"] = "2x Exalted Attack",
    ["5"] = "3x Exalted Attack",
    ["6"] = "4x Exalted Attack",
    ["7"] = "5x Exalted Attack",
    ["8"] = "6x Exalted Attack",
    ["9"] = "6x Exalted Attack"
  }
}

-- local coordinates on playermats
local RUNE_POSITIONS            = {
  Vector(0.188, 0.1, 0.128),
  Vector(0.067, 0.1, -0.085),
  Vector(-0.058, 0.1, -0.295),
  Vector(-0.188, 0.1, -0.509)
}

-------------------------------------------------------------------------------
-- MARK: onLoad / onSave
-------------------------------------------------------------------------------

function onSave()
  fresh = false
  return JSON.encode({ fresh = fresh })
end

function onLoad(saveData)
  if saveData and saveData ~= "" then
    local loadedData = JSON.decode(saveData)
    fresh = loadedData.fresh
  end

  -- we're calling this for each object since TTS does not do it on a new load
  for _, obj in ipairs(getObjects()) do
    onObjectSpawn(obj)
  end

  determineDicePositions()
  createGlobalXml()
  drawPlayAreas()

  if fresh then
    getAssetData()
  else
    print("Use the button on the right side to regenerate assets if necessary.")
  end

  -- loop to check for complete selection of destinations
  Wait.time(checkForNavigationSelection, 1, -1)
end

function onObjectSpawn(obj)
  if obj.hasTag("NotInteractable") or obj.getName() == "Wall" then
    obj.interactable = false
  end

  if obj.getName() == "SpiritWorld" then
    addMarketButton(obj)
    addPurgeButton(obj)
  end

  if obj.hasTag("HexSpirit") or obj.hasTag("Rune") then
    Wait.time(countTraitsForAllPlayers, 1)
  end
end

function addMarketButton(obj)
  obj.createButton({
    label          = "Refill Spirits",
    tooltip        = "Click this button to refill missing spirits from the supply.",
    click_function = "refillSpirits",
    position       = { -1.77, 0.22, -0.78 },
    rotation       = { 0, 270, 0 },
    width          = 1100,
    height         = 400,
    font_size      = 185,
    color          = { 0.8, 0.8, 0.8 },
    font_color     = { 0, 0, 0 },
    scale          = { 0.15, 1, 0.15 }
  })
end

function addPurgeButton(obj)
  obj.createButton({
    label          = "Purge Spirits",
    tooltip        = "Click this button to purge spirits.",
    click_function = "purgeSpirits",
    position       = { -1.77, 0.22, 0.78 },
    rotation       = { 0, 270, 0 },
    width          = 1100,
    height         = 400,
    font_size      = 185,
    color          = { 0.8, 0.8, 0.8 },
    font_color     = { 0, 0, 0 },
    scale          = { 0.15, 1, 0.15 }
  })
end

-------------------------------------------------------------------------------
-- MARK: Asset Loading
-------------------------------------------------------------------------------

function getAssetData()
  broadcastToAll("Loading Assets from remote source ...")
  WebRequestLib.get(ASSET_HOST_URL, assetRequestSuccess, assetRequestError)
end

function assetRequestSuccess(content)
  local data = JSON.decode(content)

  print("Found data with timestamp: " .. data.exported_at)

  updateSpiritReserve(data.hex_spirits)
  updateArtifactReserve(data.artifacts)
  updateMonsterReserve(data.monsters)
  updateIconReserve(data.guardians)
  updateBoards(data.boards)

  Wait.time(function() broadcastToAll("Loading complete!", "White") end, 0.1)
end

function assetRequestError(errorMessage, responseCode)
  printToAll("Could not reach host to update assets.\n(" .. ASSET_HOST_URL .. ")")
end

function updateSpiritReserve(data)
  local name = "Hex Spirits"
  local defaultPosition = Vector(0, 0.81, 0)
  local position, rotation, guid = getSomeDataFromBag(name)
  local objectList = generateSpiritData(data)
  TableLib.shuffle(objectList)
  spawnBag(name, objectList, position or defaultPosition, rotation, nil, guid)
end

function updateArtifactReserve(data)
  local basicName     = "Artifacts (Basic)"
  local basicBag      = getObjectByName(basicName)
  local basicPosition = Vector(-38, 0.61, 64)
  local basicRotation
  if basicBag then
    basicPosition = basicBag.getPosition()
    basicRotation = basicBag.getRotation()
    basicGuid     = basicBag.getGUID()
    basicBag.destruct()
  end

  local guardianName     = "Artifacts (Guardian)"
  local guardianBag      = getObjectByName(guardianName)
  local guardianPosition = Vector(-31, 0.61, 64)
  local guardianRotation
  if guardianBag then
    guardianPosition = guardianBag.getPosition()
    guardianRotation = guardianBag.getRotation()
    guardianGuid     = guardianBag.getGUID()
    guardianBag.destruct()
  end

  local otherName     = "Artifacts (Other)"
  local otherBag      = getObjectByName(otherName)
  local otherPosition = Vector(-24, 0.61, 64)
  local otherRotation
  if otherBag then
    otherPosition = otherBag.getPosition()
    otherRotation = otherBag.getRotation()
    otherGuid     = otherBag.getGUID()
    otherBag.destruct()
  end

  local artifactObjectLists = generateArtifactsData(data)
  TableLib.shuffle(artifactObjectLists.basic)
  TableLib.shuffle(artifactObjectLists.guardian)
  TableLib.shuffle(artifactObjectLists.other)

  spawnBag(basicName, artifactObjectLists.basic, basicPosition, basicRotation, nil, basicGuid)
  spawnBag(guardianName, artifactObjectLists.guardian, guardianPosition, guardianRotation, nil, guardianGuid)
  spawnBag(otherName, artifactObjectLists.other, otherPosition, otherRotation, nil, otherGuid)
end

function updateMonsterReserve(data)
  local name = "Monsters"
  local defaultPosition = Vector(0, 0.61, 41)
  local position, rotation, guid = getSomeDataFromBag(name)
  local objectList = generateMonsterData(data)
  spawnBag(name, objectList, position or defaultPosition, rotation, nil, guid)
end

function updateIconReserve(data)
  local name = "Icons"
  local defaultPosition = Vector(-45, 0.61, 64)
  local position, rotation, guid = getSomeDataFromBag(name)
  local objectList = generateIconData(data)
  spawnBag(name, objectList, position or defaultPosition, rotation, nil, guid)
end

function updateBoards(data)
  local sName = "SpiritWorld"
  local rName = "relationship_board"
  local rTag  = "RelationshipBoard"
  local sURL, rURL

  for _, subData in ipairs(data) do
    if subData.name == sName then
      sURL = subData.image_url
    elseif subData.name == rName then
      rURL = subData.image_url
    end
  end

  updateObjectImageByName(sName, sURL)

  -- lock icons
  lockObjectsByTag("Icon", true)

  updateObjectImageByTag(rTag, rURL)

  -- unlock icons
  Wait.time(function() lockObjectsByTag("Icon", false) end, 2)
end

function generateSpiritData(data)
  local objectList = {}

  for _, tbl in ipairs(data) do
    -- parse classes
    local classes = {}
    for _, v in ipairs(tbl.traits.classes) do
      classes[v.name] = (classes[v.name] or 0) + 1
    end

    -- parse origins
    local origins = {}
    for _, v in ipairs(tbl.traits.origins) do
      origins[v.name] = (origins[v.name] or 0) + 1
    end

    -- generate spirit data
    local spirit                = ObjectTemplateLib.getTemplate("Token")
    spirit.Nickname             = tbl.name
    spirit.CustomImage.ImageURL = tbl.image_url
    spirit.Transform.scaleX     = 1.58333
    spirit.Transform.scaleY     = 1
    spirit.Transform.scaleZ     = 1.58333
    spirit.Tags                 = { "HexSpirit" }
    spirit.GMNotes              = JSON.encode({
      id      = tbl.id,
      cost    = tbl.cost,
      classes = classes,
      origins = origins
    })

    table.insert(objectList, spirit)

    if tbl.cost < 6 then
      table.insert(objectList, spirit)
    end
  end

  return objectList
end

function generateArtifactsData(data)
  local objectList = {
    basic    = {},
    guardian = {},
    other    = {}
  }

  for _, tbl in ipairs(data) do
    local artifact                = ObjectTemplateLib.getTemplate("Token")
    artifact.Nickname             = tbl.name
    artifact.CustomImage.ImageURL = tbl.image_path
    artifact.Transform.scaleX     = 1.5
    artifact.Transform.scaleY     = 1
    artifact.Transform.scaleZ     = 1.5
    artifact.Tags                 = { "Artifact" }
    artifact.GMNotes              = JSON.encode({ id = tbl.id })

    local artifactType            = getArtifactType(tbl.tag_names)
    if artifactType == "Basic" then
      table.insert(objectList.basic, artifact)
    elseif artifactType == "Guardian" then
      table.insert(objectList.guardian, artifact)
    else
      table.insert(objectList.other, artifact)
    end
  end

  return objectList
end

function generateMonsterData(data)
  local objectList = {}

  for _, tbl in ipairs(data) do
    -- generate monster data
    local monster                   = ObjectTemplateLib.getTemplate("Card")
    monster.Nickname                = tbl.name
    monster.CustomDeck["1"].FaceURL = tbl.image_url
    monster.CustomDeck["1"].BackURL = tbl.image_url
    monster.Transform.scaleX        = 2
    monster.Transform.scaleY        = 1
    monster.Transform.scaleZ        = 2
    monster.Tags                    = { "Monster" }
    monster.GMNotes                 = JSON.encode({
      id      = tbl.id,
      state   = tbl.state,
      barrier = tbl.barrier,
      damage  = tbl.damage
    })
    monster.order                   = tbl.order_num

    table.insert(objectList, monster)
  end

  table.sort(objectList, function(a, b) return a.order > b.order end)
  return objectList
end

function generateIconData(data)
  local objectList = {}

  for _, tbl in ipairs(data) do
    -- generate icon data
    local icon                            = ObjectTemplateLib.getTemplate("Tile")
    icon.Nickname                         = tbl.name
    icon.CustomImage.ImageURL             = tbl.icon_image_url
    icon.CustomImage.CustomTile.Thickness = 0.1
    icon.ColorDiffuse                     = { r = 0, g = 0, b = 0 }
    icon.Transform.scaleX                 = 0.5
    icon.Transform.scaleY                 = 1
    icon.Transform.scaleZ                 = 0.5
    icon.Tags                             = { "Icon" }

    table.insert(objectList, icon)
  end

  return objectList
end

function getArtifactType(list)
  for _, tag in ipairs(list) do
    if tag == "Basic" or tag == "Guardian" then return tag end
  end
  return "Other"
end

function getSomeDataFromBag(name)
  local position, rotation, guid
  local bag = getObjectByName(name)
  if bag then
    position = bag.getPosition()
    rotation = bag.getRotation()
    guid     = bag.getGUID()
    bag.destruct()
  end
  return position, rotation, guid
end

function spawnBag(name, objectList, position, rotation, scale, guid)
  local data            = ObjectTemplateLib.getTemplate("Bag")
  scale                 = scale or Vector(2, 2, 2)
  rotation              = rotation or Vector(0, 180, 0)

  -- update bag data
  data.GUID             = guid
  data.Nickname         = name
  data.Locked           = true
  data.ContainedObjects = objectList
  data.Transform.posX   = position.x
  data.Transform.posY   = position.y
  data.Transform.posZ   = position.z
  data.Transform.rotX   = rotation.x
  data.Transform.rotY   = rotation.y
  data.Transform.rotZ   = rotation.z
  data.Transform.scaleX = scale.x
  data.Transform.scaleY = scale.y
  data.Transform.scaleZ = scale.z

  spawnObjectData({ data = data })

  printToAll("Successfully loaded '" .. name .. "' (" .. #objectList .. ").", "Green")
end

function updateObjectImageByName(name, url)
  if not name or not url then return end
  local o = getObjectByName(name)
  if o then
    o.setCustomObject({ image = url })
    o.reload()
  end
end

function updateObjectImageByTag(tag, url)
  if not tag or not url then return end
  for _, o in ipairs(getObjectsWithTag(tag)) do
    o.setCustomObject({ image = url })
    o.reload()
  end
end

function lockObjectsByTag(tag, state)
  for _, o in ipairs(getObjectsWithTag(tag)) do
    o.setLock(state)
  end
end

-------------------------------------------------------------------------------
-- MARK: XML-Code
-------------------------------------------------------------------------------

function createGlobalXml()
  local xml                  = {}

  -- Side buttons
  local SIDE_BUTTON_HEIGHT   = 200
  local SIDE_BUTTON_WIDTH    = 900
  local SIDE_BUTTON_FONTSIZE = 100
  local SIDE_BUTTON_SPACING  = 25

  for _, playerColor in ipairs(Player.getColors()) do
    if playerColor ~= "Black" and playerColor ~= "Grey" then
      local sideButtons = {
        tag = "VerticalLayout",
        attributes = {
          scale         = "0.2 0.2 1",
          width         = SIDE_BUTTON_WIDTH,
          offsetXY      = "-10 0",
          outline       = "Black",
          outlineSize   = 2,
          spacing       = SIDE_BUTTON_SPACING,
          rectAlignment = "MiddleRight",
          visibility    = playerColor
        },
        children = {
          {
            tag = "Button",
            attributes = {
              onClick   = "xml_navigateRealm",
              color     = "Black",
              textColor = "White",
              text      = "Realm Navigator",
              fontStyle = "Italic"
            }
          },
          { tag = "Panel", attributes = {}, },
          {
            tag = "Button",
            attributes = {
              onClick   = "xml_gatherDice",
              color     = "Grey",
              text      = "Gather Dice",
              fontStyle = "Italic"
            }
          },
          {
            tag = "Button",
            attributes = { id = playerColor .. "_btn_Archer", text = "Archer (0)" },
          },
          {
            tag = "Button",
            attributes = { id = playerColor .. "_btn_Sorcerer", text = "Sorcerer (0)" },
          },
          {
            tag = "Button",
            attributes = { id = playerColor .. "_btn_Swordsman", text = "Swordsman (0)" },
          },
          {
            tag = "Button",
            attributes = {
              onClick   = "xml_showReference",
              color     = "Grey",
              text      = "Show Reference",
              fontStyle = "Italic"
            },
          },
          { tag = "Panel", attributes = {}, },
          {
            tag = "Button",
            attributes = {
              onClick    = "xml_rollAllDice",
              color      = "Black",
              textColor  = "White",
              text       = "Roll All Dice",
              fontStyle  = "Italic",
              visibility = "Admin"
            }
          },
          { tag = "Panel", attributes = {}, },
          {
            tag = "Button",
            attributes = {
              onClick    = "getAssetData",
              color      = "Black",
              textColor  = "White",
              text       = "Reload Assets",
              fontStyle  = "Italic",
              visibility = "Admin"
            }
          }
        }
      }

      for _, data in ipairs(sideButtons.children) do
        data.attributes.padding       = "50 0 0 0"
        data.attributes.textAlignment = "MiddleLeft"
        data.attributes.fontSize      = SIDE_BUTTON_FONTSIZE
      end

      local num = #sideButtons.children
      sideButtons.attributes.height = SIDE_BUTTON_HEIGHT * num + SIDE_BUTTON_SPACING * (num - 1)
      table.insert(xml, sideButtons)

      -- class reference
      local reference = {
        tag = "VerticalLayout",
        attributes = {
          id            = playerColor .. "_reference_window",
          height        = "1200",
          width         = "942",
          rectAlignment = "MiddleCenter",
          active        = "false",
          visibility    = playerColor,
          scale         = "0.75 0.75 1"
        },
        children = {
          -- Image Display
          {
            tag = "Image",
            attributes = {
              image           =
              "https://gvxfokbptelmvvlxbigh.supabase.co/storage/v1/object/public/game_assets/misc_assets/e1f25e0a-96e9-4ee4-9e5e-c8373f81d9c4/Screenshot_2025-11-28_at_9.39.38_PM.png",
              preferredHeight = "1200",
              height          = "1200"
            }
          },
          -- Close Button
          {
            tag = "Button",
            attributes = {
              onClick              = "xml_closeReference",
              text                 = "Close",
              color                = "Grey",
              preferredHeight      = "75",
              height               = "75",
              resizeTextForBestFit = true
            }
          }
        }

      }

      table.insert(xml, reference)
    end
  end

  UI.setXmlTable(xml)
end

function xml_rollAllDice()
  for playerColor, data in pairs(playAreaData) do
    local searchResult = SearchLib.inArea(data.center, nil, data.size, "isDie")
    for _, die in ipairs(searchResult) do
      die.randomize()
    end
  end
end

function xml_showReference(player)
  UI.setAttribute(player.color .. "_reference_window", "active", true)
end

function xml_closeReference(player)
  UI.setAttribute(player.color .. "_reference_window", "active", false)
end

function onObjectDrop(playerColor, obj)
  if obj.hasTag("HexSpirit") or obj.hasTag("Rune") then
    Wait.time(countTraitsForAllPlayers, 1)
  end
end

function countTraitsForAllPlayers()
  if queue then
    Wait.stop(queue)
  end

  queue = Wait.time(function()
    for _, player in ipairs(Player.getPlayers()) do
      local playerColor = player.color
      local handData = Player[playerColor].getHandTransform()
      if handData then
        local traits = countTraitsForPlayer(playerColor)
        for _, trait in ipairs({ "Swordsman", "Archer", "Sorcerer" }) do
          local traitCount = traits[trait] or 0
          local elementId = playerColor .. "_btn_" .. trait
          UI.setAttribute(elementId, "text", trait .. " (" .. traitCount .. ")")

          local diceText = DICE_OPTIONS[trait][tostring(math.min(traitCount, 9))]
          traitSettingsPerPlayer[playerColor] = traitSettingsPerPlayer[playerColor] or {}
          traitSettingsPerPlayer[playerColor][trait] = diceText
        end
      end
      removeDiceForPlayer(playerColor)
      spawnDiceForPlayer(playerColor)
    end
  end, 0.5)
end

function countTraitsForPlayer(playerColor)
  local playermat = getPlayermat(playerColor)
  if not playermat then return {} end

  local searchResult = SearchLib.onObject(playermat, "isHexSpirit")

  local classes = {}
  for _, obj in ipairs(searchResult) do
    local md = getMetadata(obj.getGMNotes())
    for class, count in pairs(md.classes) do
      classes[class] = (classes[class] or 0) + count
    end
  end

  return classes
end

function xml_gatherDice(player)
  countTraitsForPlayer(player.color)

  broadcastToColor("Removing all dice from your playarea first.", player.color)

  removeDiceForPlayer(player.color)
  spawnDiceForPlayer(player.color)
end

function spawnDiceForPlayer(playerColor)
  diceCountPerPlayer[playerColor] = nil

  local traitSettings = traitSettingsPerPlayer[playerColor]
  if not traitSettings then
    log("Could not determine trait settings for " .. playerColor .. ".")
    return
  end

  for traitType, diceText in pairs(traitSettings) do
    local diceData = determineDiceNameAndCount(diceText)

    -- special handling for Sorcerers
    local multiplier = 1

    if traitType == "Sorcerer" then
      multiplier = getRuneCount(playerColor)
    end

    for i = 1, multiplier do
      for _, data in ipairs(diceData) do
        if data.amount and data.amount > 0 then
          --printToAll("Spawning " .. data.amount .. " " .. data.type .. " dice (" .. traitType .. ").")
          spawnDice(data.type, data.amount, playerColor)
        end
      end
    end
  end

  -- always spawn defense dice
  --printToAll("Spawning 1 defense dice.")
  spawnDice("Defense", 1, playerColor)

  --broadcastToColor("Completed dice spawning for you.", playerColor)
end

function removeDiceForPlayer(playerColor)
  local handData = Player[playerColor].getHandTransform()
  if not handData then return end

  local searchSize = Vector(30, 10, 38)
  local searchCenter = handData.position + handData.forward * 14
  local searchResult = SearchLib.inArea(searchCenter, nil, searchSize, "isDie")
  for _, obj in ipairs(searchResult) do
    if obj.hasTag("TempDie") then
      obj.destruct()
    end
  end
end

function determineDiceNameAndCount(text)
  local diceTable = {}

  -- Pattern Breakdown:
  -- (%d+)    : Capture the amount (digits)
  -- x%s+     : Match 'x' followed by space
  -- ([^,]+)  : Capture EVERYTHING until a comma (or end of string)
  for amount, rawType in text:gmatch("(%d+)x%s+([^,]+)") do
    -- Remove " x Runes" if it exists
    -- Remove any trailing spaces left over
    local cleanType = rawType:gsub(" x Runes", ""):gsub("%s+$", "")
    table.insert(diceTable, { amount = tonumber(amount), type = cleanType })
  end

  return diceTable
end

function spawnDice(name, count, playerColor)
  local sourceBag = getObjectByName("Dice Source")
  if not sourceBag then
    printToAll("Can't find dice source bag.", "Red")
    return
  end

  for _, objData in ipairs(sourceBag.getData().ContainedObjects) do
    if objData["Nickname"] == name then
      for i = 1, count do
        local diePos = getDiePos(playerColor)
        local dieRot = getDieRot(playerColor)
        if name == "Defense" then
          dieRot = Vector(26.57, dieRot.y - 3.25, 0)
          diePos = diePos:setAt("y", 1.88)
        else
          diePos = diePos:setAt("y", 1.74)
        end
        objData["Tags"] = { "Die", "TempDie" }
        local die = spawnObjectData({ data = objData, position = diePos, rotation = dieRot })
      end
      return
    end
  end

  printToAll("Didn't find dice with name " .. name .. ".", "Red")
end

function getDiePos(playerColor)
  local count = diceCountPerPlayer[playerColor] or 1
  diceCountPerPlayer[playerColor] = count + 1
  return dicePositionsPerPlayer[playerColor][count]
end

function getDieRot(playerColor)
  local handData = Player[playerColor].getHandTransform()
  if handData then
    return handData.rotation
  end
end

function determineDicePositions()
  local DICE_SPACING_X = 3 -- Space between dice columns (right/left)
  local DICE_SPACING_Z = 3 -- Space between dice rows (forward/backward)

  for _, playerColor in ipairs(Player.getAvailableColors()) do
    local handData = Player[playerColor].getHandTransform()
    if handData then
      local centerPos = handData.position + handData.forward * 22 + handData.right * 12
      dicePositionsPerPlayer[playerColor] = {}

      -- Calculate the total size of the grid to center it
      local grid_width = (5 - 1) * DICE_SPACING_X
      local grid_length = (3 - 1) * DICE_SPACING_Z

      -- Center the grid
      local start_offset_x = -grid_width / 2.0
      local start_offset_z = -grid_length / 2.0

      for row = 1, 3 do
        for col = 1, 5 do
          local offset_x = start_offset_x + (col - 1) * DICE_SPACING_X
          local offset_z = start_offset_z + (row - 1) * DICE_SPACING_Z
          local total_offset = handData.right * offset_x + handData.forward * offset_z
          local finalPosition = (centerPos + total_offset)
          table.insert(dicePositionsPerPlayer[playerColor], finalPosition)
        end
      end
    end
  end
end

-- shows the destination selection to the triggering player
function xml_navigateRealm(player)
  local playerColor = player.color
  if playerColor == "Grey" or playerColor == "Black" then return end
  local default = destinationPerPlayerColor[playerColor] or 1
  Player[playerColor].showOptionsDialog("Choose Destination:", NAVIGATE_OPTIONS, default, navigateRealmCallback)
end

-- called when a player confirms the navigation selection
function navigateRealmCallback(selectedDestination, _, playerColor)
  destinationPerPlayerColor[playerColor] = selectedDestination
  printToColor("You selected: " .. selectedDestination, playerColor)
  printToAll(getColoredName(playerColor) .. " chose a destination.")
end

-- repeatedly called to check if each player has chosen a destination
function checkForNavigationSelection()
  if not next(destinationPerPlayerColor) then return end

  for _, player in ipairs(Player.getPlayers()) do
    local playerColor = player.color
    if playerColor ~= "Grey" and playerColor ~= "Black" then
      if destinationPerPlayerColor[playerColor] == nil then return end
    end
  end

  broadcastToAll("Every player has chosen a destination for this round!", "Green")
  for playerColor, destination in pairs(destinationPerPlayerColor) do
    printToAll(getColoredName(playerColor) .. " = " .. destination)
  end

  destinationPerPlayerColor = {}
end

-------------------------------------------------------------------------------
-- MARK: Market + Purging
-------------------------------------------------------------------------------

-- return the Hex Spirit at a specific index in the market (1 - 6)
function getMarketSpirit(id)
  local pos = MARKET_SPIRIT_POSITIONS[id]
  local searchResult = SearchLib.atPosition(pos, "isHexSpirit")
  return searchResult[1]
end

-- counts how many Hex Spirits this monster has sealed already (1 - 5)
function getNumberOfSealedSpirits(id)
  for _, obj in ipairs(getObjectsWithTag("SpiritContainer")) do
    if tonumber(string.sub(obj.getName(), -1)) == id then
      return obj.getQuantity()
    end
  end
  return 0
end

-- refills the market of Hex Spirits, skipping full spots
function refillSpirits(_, playerColor)
  local bag = getObjectByName("Hex Spirits")
  if not bag then
    printToAll("Bag with Hex Spirits not found!", "Red")
    return
  end

  local neededRefill = false
  local shuffled = false

  for i, pos in ipairs(MARKET_SPIRIT_POSITIONS) do
    local searchResult = SearchLib.atPosition(pos, "isHexSpirit")
    if #searchResult == 0 then
      if not shuffled then
        bag.shuffle()
        shuffled = true
      end
      bag.takeObject({ position = pos, rotation = Vector(0, (i - 1) * 60, 0) })
      neededRefill = true
    end
  end

  if not neededRefill and playerColor then
    broadcastToColor("There are already 6 spirits placed.", playerColor, "Orange")
  end
end

-- loops through the monsters and lets them seal Hex Spirits from the market
function purgeSpirits()
  refillSpirits()

  broadcastToAll("Performing Purge ...")

  local d = 1.2
  for monsterIndex = 1, 5 do
    Wait.time(function()
      performPurgeForMonster(monsterIndex)

      Wait.time(refillSpirits, (monsterIndex - 0.5) * d)

      if monsterIndex == 5 then
        Wait.time(function()
          printToAll("---------------------")
          broadcastToAll("Purge completed!")
        end, 0.3)
      end
    end, monsterIndex * d)
  end
end

-- this function performs the actual purging for a specific monster (1 - 5)
function performPurgeForMonster(monsterIndex)
  printToAll("---------------------")
  local stealCost           = SEAL_TARGET_COST[monsterIndex]
  local stealAmount         = SEAL_PER_PURGE[monsterIndex]
  local stolenAmount        = 0
  local alreadySealedAmount = getNumberOfSealedSpirits(monsterIndex)
  local maximumSealedLimit  = MAX_SEALED_SPIRITS[monsterIndex]
  local m                   = "Monster " .. monsterIndex

  local container           = getObjectByName("Sealed Spirits By Monster " .. monsterIndex)
  if not container then
    printToAll("Could not find container for sealed Hex Spirits with index " .. monsterIndex .. ".", "Red")
    return
  end

  -- temporary solution for easy customization
  local desc = container.getDescription()
  local sealAmount, sealMaximum = desc:match("SealAmount: (%d+)\nSealMaximum: (%d+)")
  stealAmount = tonumber(sealAmount)
  maximumSealedLimit = tonumber(sealMaximum)
  ---

  for marketIndex = 1, 6 do
    if alreadySealedAmount >= maximumSealedLimit then
      Wait.time(function()
        printToAll(m .. " has sealed the maximum amount (" .. maximumSealedLimit .. ").")
      end, (stolenAmount - 1) * 0.2 + 0.1)
      return
    end

    local hexSpirit = getMarketSpirit(marketIndex)
    if hexSpirit and getMetadata(hexSpirit.getGMNotes()).cost == stealCost then
      stolenAmount        = stolenAmount + 1
      alreadySealedAmount = alreadySealedAmount + 1

      Wait.time(function()
        container.putObject(hexSpirit)
        printToAll(m .. " sealed " .. hexSpirit.getName() .. "!")
      end, (stolenAmount - 1) * 0.2)

      -- end loop if enough spirits were stolen
      if stolenAmount == stealAmount then return end
    end
  end

  local s = stolenAmount .. " spirits"
  if stolenAmount == 1 then
    s = stolenAmount .. " spirit"
  end

  Wait.time(function()
    printToAll(m .. " could not seal as many spirits as it wanted\n(it sealed " .. s .. ").")
  end, stolenAmount * 0.2)
end

-------------------------------------------------------------------------------
-- MARK: General Helpers
-------------------------------------------------------------------------------

function getRuneCount(playerColor)
  local runeCount = 0
  local playermat = getPlayermat(playerColor)
  if not playermat then return 0 end

  for _, runePos in ipairs(RUNE_POSITIONS) do
    local searchPos = playermat.positionToWorld(runePos)
    local searchResult = SearchLib.atPosition(searchPos, "isRune")
    if #searchResult > 0 then
      runeCount = runeCount + 1
    end
  end

  return runeCount
end

function getPlayermat(playerColor)
  local handData = Player[playerColor].getHandTransform()
  if not handData then return end

  local startPos = handData.position
  local result, smallestDistance
  for _, mat in ipairs(getObjectsWithTag("Playermat")) do
    local distance = Vector.between(startPos, mat.getPosition()):magnitude()
    if smallestDistance == nil or distance < smallestDistance then
      smallestDistance = distance
      result = mat
    end
  end
  return result
end

-- helper function to generate a string with colored player name
function getColoredName(playerColor)
  local displayName = playerColor
  if playerColor ~= "Grey" and Player[playerColor].steam_name then
    displayName = Player[playerColor].steam_name
  end

  -- add bb-code
  return "[" .. Color.fromString(playerColor):toHex() .. "]" .. displayName .. "[-]"
end

-- helper function to find objects by name
function getObjectByName(name)
  for _, obj in ipairs(getObjects()) do
    if obj.getName() == name then
      return obj
    end
  end
  return nil
end

function getMetadata(data)
  return JSON.decode(data) or {}
end

-------------------------------------------------------------------------------
-- MARK: Box Drawing
-------------------------------------------------------------------------------

function drawPlayAreas()
  local allLines = Global.getVectorLines() or {}

  for _, playerColor in ipairs(Player.getAvailableColors()) do
    local handData = Player[playerColor].getHandTransform()
    if handData then
      local boxCenter = handData.position + handData.forward * 22.7 + handData.right * 11.5
      drawBox(allLines, boxCenter:setAt("y", 1.1), handData.forward, handData.right, 16, 13.5, playerColor, 0.3)

      local size = handData.forward * 13.5 + handData.right * 16
      playAreaData[playerColor] = {
        center = boxCenter:setAt("y", 1),
        size   = Vector(math.abs(size.x), 10, math.abs(size.z))
      }
    end
  end

  Global.setVectorLines(allLines)
end

-- Helper function to draw a box
function drawBox(linesTable, center, forwardVector, rightVector, width, length, color, thickness)
  -- Calculate the four corners of the box relative to the center
  local p1 = center + (rightVector * width / 2) + (forwardVector * length / 2)
  local p2 = center + (rightVector * width / 2) - (forwardVector * length / 2)
  local p3 = center - (rightVector * width / 2) - (forwardVector * length / 2)
  local p4 = center - (rightVector * width / 2) + (forwardVector * length / 2)

  -- Insert the lines into the provided table
  table.insert(linesTable, { points = { p1, p2 }, color = color, thickness = thickness })
  table.insert(linesTable, { points = { p2, p3 }, color = color, thickness = thickness })
  table.insert(linesTable, { points = { p3, p4 }, color = color, thickness = thickness })
  table.insert(linesTable, { points = { p4, p1 }, color = color, thickness = thickness })
end
end)
__bundle_register("ObjectTemplateLib", function(require, _LOADED, __bundle_register, __bundle_modules)
do
  local ObjectTemplateLib = {}
  local TableLib          = require("TableLib")

  local TEMPLATES         = {
    bag = {
      Name             = "Bag",
      Transform        = {
        rotY   = 180,
        scaleX = 1,
        scaleY = 1,
        scaleZ = 1
      },
      Nickname         = "Bag",
      ColorDiffuse     = { r = 0.7, g = 0.35, b = 0 },
      Bag              = { Order = 0 },
      ContainedObjects = {}
    },
    tile = {
      Name = "Custom_Tile",
      Transform = {
        rotY   = 180,
        scaleX = 1,
        scaleY = 1,
        scaleZ = 1
      },
      ColorDiffuse = { r = 1, g = 1, b = 1 },
      CustomImage = {
        ImageURL    = "",
        ImageScalar = 1,
        WidthScale  = 0,
        CustomTile  = {
          Type      = 0,
          Thickness = 0.2,
          Stackable = false,
          Stretch   = true
        }
      }
    },
    token = {
      Name = "Custom_Token",
      Transform = {
        rotY   = 180,
        scaleX = 1,
        scaleY = 1,
        scaleZ = 1
      },
      ColorDiffuse = { r = 1, g = 1, b = 1 },
      CustomImage = {
        ImageURL    = "",
        ImageScalar = 1,
        WidthScale  = 0,
        CustomToken = {
          Thickness           = 0.2,
          MergeDistancePixels = 25,
          StandUp             = false,
          Stackable           = false
        }
      }
    },
    card = {
      Name = "Card",
      Transform = {
        rotY   = 180,
        scaleX = 1,
        scaleY = 1,
        scaleZ = 1
      },
      CardID = 100,
      CustomDeck = {
        ["1"] = {
          BackIsHidden = true,
          BackURL      = "",
          FaceURL      = "",
          NumHeight    = 1,
          NumWidth     = 1,
          Type         = 0,
          UniqueBack   = false
        }
      }
    }
  }

  function ObjectTemplateLib.getTemplate(objectType)
    local template = TEMPLATES[string.lower(objectType)]
    if not template then
      printToAll("Did not find an object template for " .. objectType .. ".", "Red")
      return
    end
    return TableLib.copy(template)
  end

  return ObjectTemplateLib
end
end)
__bundle_register("SearchLib", function(require, _LOADED, __bundle_register, __bundle_modules)
do
  local SearchLib = {}
  local FILTER_FUNCTIONS = {
    isCard            = function(x) return x.type == "Card" end,
    isDeck            = function(x) return x.type == "Deck" end,
    isCardOrDeck      = function(x) return x.type == "Card" or x.type == "Deck" end,
    isInteractable    = function(x) return x.interactable end,
    isTileOrToken     = function(x) return not x.Book and (x.type == "Tile" or x.type == "Generic") end,
    isHexSpirit       = function(x) return x.hasTag("HexSpirit") end,
    isSpiritContainer = function(x) return x.hasTag("SpiritContainer") end,
    isRune            = function(x) return x.hasTag("Rune") end,
    isDie             = function(x) return x.hasTag("Die") end
  }

  -- performs the actual search and returns a filtered list of object references
  ---@param pos tts__Vector Global position
  ---@param rot? tts__Vector Global rotation
  ---@param size table Size
  ---@param filter? string Name of the filter function
  ---@param direction? table Direction (positive is up)
  ---@param maxDistance? number Distance for the cast
  ---@param debug? boolean Whether the debug boxes should be shown
  local function returnSearchResult(pos, rot, size, filter, direction, maxDistance, debug)
    local filterFunc = filter and FILTER_FUNCTIONS[filter]
    local searchResult = Physics.cast({
      origin       = pos,
      direction    = direction or { 0, 1, 0 },
      orientation  = rot or { 0, 0, 0 },
      type         = 3,
      size         = size,
      max_distance = maxDistance or 0,
      debug        = debug or false
    })

    -- filter the result for matching objects
    local objList = {}
    for _, v in ipairs(searchResult) do
      if (not filter or filterFunc(v.hit_object)) then
        table.insert(objList, v.hit_object)
      end
    end
    return objList
  end

  -- searches the specified area
  function SearchLib.inArea(pos, rot, size, filter, debug)
    return returnSearchResult(pos, rot, size, filter, nil, nil, debug)
  end

  -- searches the area on an object
  function SearchLib.onObject(obj, filter, scale, debug)
    scale      = scale or 1
    local pos  = obj.getPosition() + Vector(0, 1, 0) -- offset by half the cast's height
    local size = obj.getBounds().size:scale(scale):setAt("y", 2)
    return returnSearchResult(pos, nil, size, filter, nil, nil, debug)
  end

  -- searches the area directly below an object
  function SearchLib.belowObject(obj, filter, scale, debug)
    scale        = scale or 1
    local objPos = obj.getPosition()
    local pos    = objPos + Vector(0, -objPos.y / 2, 0) -- offset by half the cast's height
    local size   = obj.getBounds().size:scale(scale):setAt("y", objPos.y)
    return returnSearchResult(pos, nil, size, filter, nil, nil, debug)
  end

  -- searches the specified position (a single point)
  function SearchLib.atPosition(pos, filter, debug)
    local size = { 0.1, 2, 0.1 }
    return returnSearchResult(pos, nil, size, filter, nil, nil, debug)
  end

  -- searches below the specified position (downwards until y = 0)
  function SearchLib.belowPosition(pos, filter, debug)
    local size = { 0.1, 2, 0.1 }
    local direction = { 0, -1, 0 }
    local maxDistance = pos.y
    return returnSearchResult(pos, nil, size, filter, direction, maxDistance, debug)
  end

  return SearchLib
end
end)
__bundle_register("TableLib", function(require, _LOADED, __bundle_register, __bundle_modules)
do
  local TableLib = {}

  -- Checks if a list contains an element
  ---@param t table
  ---@param ele any
  function TableLib.contains(t, ele)
    if t == nil then return false end
    for k, v in ipairs(t) do
      if v == ele then return true end
    end
    return false
  end

  -- Copies a table (or returns the original if not a table)
  ---@param t table
  function TableLib.copy(t)
    if type(t) ~= "table" then return t end
    local copy = {}
    for tKey, tValue in next, t, nil do
      copy[TableLib.copy(tKey)] = TableLib.copy(tValue)
    end
    setmetatable(copy, TableLib.copy(getmetatable(t)))
    return copy
  end

  -- Returns the index of an element
  ---@param t table
  ---@param ele any
  function TableLib.getElementIndex(t, ele)
    if t == nil then return nil end
    for k, v in ipairs(t) do
      if v == ele then return k end
    end
    return nil
  end

  -- Returns the keys of a table as new table
  ---@param t table
  ---@param filterValue? any Only keys with this value will be extracted
  function TableLib.getKeys(t, filterValue)
    local keys = {}
    for k, v in pairs(t) do
      if filterValue == nil or v == filterValue then
        table.insert(keys, k)
      end
    end
    return keys
  end

  -- Checks if a table is empty
  ---@param t table
  function TableLib.isEmpty(t)
    return next(t) == nil
  end

  -- Returns a map from a list (value = true)
  ---@param t table
  function TableLib.makeMap(t)
    local m = {}
    for _, v in ipairs(t) do
      m[v] = true
    end
    return m
  end

  -- Returns a random list element
  ---@param t table
  function TableLib.pickRandom(t)
    return t[math.random(#t)]
  end

  -- Returns a reversed list
  ---@param t table
  function TableLib.reverse(t)
    local r = {}
    for i = #t, 1, -1 do
      table.insert(r, t[i])
    end
    return r
  end

  -- Shuffles a list in place (Fisher-Yates-Shuffle)
  ---@param t table
  function TableLib.shuffle(t)
    local n = #t
    while n > 1 do
      local k = math.random(n)
      t[n], t[k] = t[k], t[n]
      n = n - 1
    end
    return t
  end

  -- Returns a copy of a list without duplicates
  ---@param t table
  function TableLib.removeDuplicates(t)
    local seen = {}
    local result = {}
    for _, value in ipairs(t) do
      if not seen[value] then
        seen[value] = true
        table.insert(result, value)
      end
    end
    return result
  end

  return TableLib
end
end)
__bundle_register("TtsLuaAdditions", function(require, _LOADED, __bundle_register, __bundle_modules)
-- Add division by number to Vector class
---@param vec tts__Vector
---@param val number
function Vector.__div(vec, val)
  return vec:copy():scale(1 / val)
end

-- Add division by number to Color class (does not change alpha)
---@param col tts__Color
---@param val number
function Color.__div(col, val)
  return Color(col.r / val, col.g / val, col.b / val, col.a)
end

-- Add multiplication by number to Color class (does not change alpha)
---@param col tts__Color
---@param val number
function Color.__mul(col, val)
  return Color(col.r * val, col.g * val, col.b * val, col.a)
end
end)
__bundle_register("WebRequestLib", function(require, _LOADED, __bundle_register, __bundle_modules)
do
  local WebRequestLib = {}

  -- This function encapsulates the entire request logic, providing distinct
  -- success and error callbacks that directly receive the processed data or error.
  ---@param uri table|string The URL for the GET request.
  ---@param onSuccess fun(content: string) Called when the request is successful.
  ---@param onError fun(errorMessage: string, responseCode: number|nil) Called when an error occurs (either network or HTTP error).
  function WebRequestLib.get(uri, onSuccess, onError)
    -- Format URI if it's a table (e.g., {"api", "data"} -> "api/data")
    if type(uri) == "table" then
      uri = table.concat(uri, "/")
    end

    WebRequest.get(uri, function(requestInstance)
      if requestInstance.is_error then
        -- Network level error
        local errorMessage = requestInstance.error or "Unknown network error"
        if onError then
          onError(errorMessage)
        end
      elseif requestInstance.response_code and requestInstance.response_code >= 400 then
        -- HTTP error (4xx or 5xx status codes)
        local errorMessage = "HTTP Error " ..
        requestInstance.response_code .. ": " .. (requestInstance.text or "No error message provided.")
        if onError then
          onError(errorMessage, requestInstance.response_code)
        end
      else
        -- Successful request (2xx or 3xx status codes)
        if onSuccess then
          onSuccess(requestInstance.text)
        end
      end
    end)
  end

  return WebRequestLib
end
end)
__bundle_register("__root", function(require, _LOADED, __bundle_register, __bundle_modules)
require("Global")
end)
return __bundle_require("__root")