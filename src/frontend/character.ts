import type { ImageLayer, CharacterSvgDto } from './types'

import { RenderCache } from "./rendercache";
import { annualEvents } from "../common/annualevents";
import { stringToImageList, logToServer } from "./utils";


type CharacterFormat = "svg" | "png"
const characterVersions = ["normal", "alt"] as const
export type CharacterVersion = typeof characterVersions[number]
type CharacterSide = "front" | "back"
const characterStates = ["stand", "sit", "walk1", "walk2"] as const
export type CharacterState = typeof characterStates[number]


type RawImages = {
    [key: string]: ImageLayer[]
}

type RenderImage = {
    [key: string]: RenderCache[]
}

const characterFeatureNames = [
    "eyes_open",
    "eyes_closed",
    "mouth_open",
    "mouth_closed",
]

type PortraitProps = {
    left?: number,
    top?: number,
    scale?: number,
}

type CharacterObject = {
    name: string,
    format?: CharacterFormat,
    isHidden?: boolean,
    isEvent?:boolean,
    scale?: number,
    portrait?: PortraitProps
}

type CharacterProps = {
    version: CharacterVersion,
    isShowingBack: boolean,
    state: CharacterState,
    isMirroredLeft: boolean,
    hasEyesClosed?: boolean,
    hasMouthClosed?: boolean,
}

export class Character
{
    public characterName: string
    public format: CharacterFormat
    public isHidden: boolean
    public isEvent: boolean

    public portrait: PortraitProps = {
        left: -0.5,
        top: 0,
        scale: 1.9
    }
    public scale: number // private
    
    public rawImages: RawImages = {} // private
    public renderImages: RenderImage = {} // private
    
    public dto: CharacterSvgDto | null = null // private
    public isLoaded: boolean = false
    
    constructor({
            name,
            format = "svg",
            isHidden = false,
            scale = 0.5,
            portrait,
            isEvent = false,
        }: CharacterObject)
    {
        this.characterName = name;
        this.format = format;
        
        Object.assign(this.portrait, portrait)
        
        // On new year's, all characters are visible
        this.isHidden = annualEvents.newYears.isNow() ? false : isHidden
        this.isEvent = annualEvents.newYears.isNow() ? false : isEvent
        
        this.scale = scale
    }
    
    public getImage({version='normal', isShowingBack=false, state='stand', isMirroredLeft=false, hasEyesClosed=true, hasMouthClosed=true}: CharacterProps)
    {
        let side: CharacterSide = isShowingBack ? "back" : "front"
        // Fallback properties
        if(!this.rawImages[[version, side, state].join(",")])
        {
            version = "normal"
            if(!this.rawImages[[version, side, state].join(",")])
            {
                state = "stand"
                if(!this.rawImages[[version, side, state].join(",")])
                    side = "front"
            }
        }
        const rawImageLayers = this.rawImages[[version, side, state].join(",")]
        if (rawImageLayers == null) return []
        // Not sure why, but rawImageLayers seems to have "undefined" elements sometimes.
        // Maybe that happens when stringToImageList() throws an exception? Logging some info
        // so we can figure out what's going on next time it happens to someone
        const rawImagesLayersNoFalsyElements = rawImageLayers.filter(o => o)
        if (rawImagesLayersNoFalsyElements.length != rawImageLayers.length)
            logToServer("ERROR! falsy element in rawImageLayers, " + this.characterName + " " + JSON.stringify(
                {version, isShowingBack, state, isMirroredLeft, hasEyesClosed, hasMouthClosed}))

        if (!rawImagesLayersNoFalsyElements) return []
        
        const imageKeyArray = [
            version,
            side,
            state,
            isMirroredLeft
        ]

        if (rawImagesLayersNoFalsyElements.find(o => o.tags && o.tags.includes("eyes_closed")))
            imageKeyArray.push(hasEyesClosed)
        if (rawImagesLayersNoFalsyElements.find(o => o.tags && o.tags.includes("mouth_closed")))
            imageKeyArray.push(hasMouthClosed)
        
        const imageKey = imageKeyArray.join(",")
        
        if (this.renderImages[imageKey]) return this.renderImages[imageKey]
        
        const outputLayers = rawImagesLayersNoFalsyElements.filter(o => (!o.tags
            || hasEyesClosed && o.tags.includes("eyes_closed")
            || !hasEyesClosed && o.tags.includes("eyes_open")
            || hasMouthClosed && o.tags.includes("mouth_closed")
            || !hasMouthClosed && o.tags.includes("mouth_open")))
        
        this.renderImages[imageKey] = outputLayers.map(o => RenderCache.Image(o.image, this.scale, isMirroredLeft))
        return this.renderImages[imageKey]
    }
    
    public setDto(dto: CharacterSvgDto)
    {
        this.dto = dto
        this.isLoaded = false
    }

    // returns true to the first caller to load the character images, indicating a request to redraw
    public async load(): Promise<boolean>
    {
        if (!this.dto) return false
        const dto = this.dto
        this.dto = null
        
        const rawImages: RawImages = {}
        const addImageString = async (version: CharacterVersion, side: CharacterSide, state: CharacterState, svgString: string) =>
        {
            rawImages[[version, side, state].join(",")] =
                await stringToImageList(svgString, dto.isBase64)
        }
        
        const promises = [
            addImageString("normal", "front", "stand", dto.frontStanding),
            addImageString("normal", "front", "sit", dto.frontSitting),
            addImageString("normal", "front", "walk1", dto.frontWalking1),
            addImageString("normal", "front", "walk2", dto.frontWalking2),
            addImageString("normal", "back", "stand", dto.backStanding),
            addImageString("normal", "back", "sit", dto.backSitting),
            addImageString("normal", "back", "walk1", dto.backWalking1),
            addImageString("normal", "back", "walk2", dto.backWalking2)
        ]
        
        if (dto.frontStandingAlt) promises.push(addImageString("alt", "front", "stand", dto.frontStandingAlt))
        if (dto.frontSittingAlt) promises.push(addImageString("alt", "front", "sit", dto.frontSittingAlt))
        if (dto.frontWalking1Alt) promises.push(addImageString("alt", "front", "walk1", dto.frontWalking1Alt))
        if (dto.frontWalking2Alt) promises.push(addImageString("alt", "front", "walk2", dto.frontWalking2Alt))
        if (dto.backStandingAlt) promises.push(addImageString("alt", "back", "stand", dto.backStandingAlt))
        if (dto.backSittingAlt) promises.push(addImageString("alt", "back", "sit", dto.backSittingAlt))
        if (dto.backWalking1Alt) promises.push(addImageString("alt", "back", "walk1", dto.backWalking1Alt))
        if (dto.backWalking2Alt) promises.push(addImageString("alt", "back", "walk2", dto.backWalking2Alt))
        
        await Promise.all(promises)
        
        if (this.dto === null)
        {
            this.rawImages = rawImages
            this.renderImages = {}
            this.isLoaded = true
            return true
        }
        else
        {
            return false // in the meantime a new dto was set and will be loaded instead
        }
    }
}

const characterObjects: CharacterObject[] = [
    { name: "shobon_raincoat",  isEvent: true, isHidden: annualEvents.rainy.isNow() },
    { name: "shii_raincoat",    isEvent: true, isHidden: annualEvents.rainy.isNow() },

    { name: "tokita_naito", isEvent: true, isHidden: annualEvents.spooktober.isNow() },
    { name: "pumpkinhead",  isEvent: true, isHidden: annualEvents.spooktober.isNow() },
    { name: "naito_yurei",  isEvent: true, isHidden: annualEvents.spooktober.isNow() },
    { name: "shiinigami",   isEvent: true, isHidden: annualEvents.spooktober.isNow() },
    
    { name: "giko_hat",     isEvent: true, isHidden: annualEvents.christmasTime.isNow() },
    { name: "shii_hat",     isEvent: true, isHidden: annualEvents.christmasTime.isNow()},
    { name: "shobon_hat",   isEvent: true, isHidden: annualEvents.christmasTime.isNow() },

    // normal characters
    { name: "giko" },
    { name: "shii" },
    { name: "shobon" },
    { name: "zonu" },
    { name: "naito" },
    { name: "hikki" },
    { name: "george" },
    { name: "salmon" },
    { name: "nida" },
    { name: "chotto_toorimasu_yo" },
    { name: "dokuo" },
    { name: "tabako_dokuo", isHidden: true },
    { name: "onigiri" },
    { name: "tinpopo" },

    //furo
    { name: "uzukumari" },
    { name: "furoshiki" },
    { name: "golden_furoshiki", isEvent: true, isHidden: annualEvents.goldenWeek.isNow() },
    { name: "furoshiki_shobon" },
    { name: "furoshiki_shii"},
    { name: "sakura_furoshiki_shii"},

    // gikos
    { name: "hotsuma_giko" },
    { name: "kimono_giko" },
    { name: "hentai_giko",      isHidden: true },
    { name: "giko_basketball",  isHidden: true },
    { name: "tikan_giko",       isHidden: true },
    { name: "hungry_giko",      isHidden: true },
    { name: "giko_shamisen",    isHidden: true },
    { name: "prison_giko",      isHidden: true,},
    { name: "giko_cop",         isHidden: true, format: "png" },
    { name: "giko_islam",       isHidden: true, format: "png"},
    { name: "long_giko",        isHidden: true, format: "png"},
    { name: "mol_giko",         isHidden: true, format: "png"},
    { name: "mitsu_giko",       isHidden: true},
    { name: "gacha",            isHidden: true },

    // shii
    { name: "shii_syakuhati", isHidden: true },
    { name: "kimono_shii" },
    { name: "shii_pianica" },
    { name: "shii_uniform" },
    { name: "shii_toast"},
    { name: "shii_shintaisou" },
    { name: "shii_islam", isHidden: true, format: "png" },

    // shobon
    { name: "baba_shobon", isHidden: true },

    // naito
    { name: "naitoapple" },
    { name: "panda_naito" },
    { name: "wild_panda_naito",     isHidden: true },
    { name: "kaminarisama_naito",   isHidden: true },
    { name: "funkynaito",           isHidden: true },
    { name: "mikan_naito",          isHidden: true },
    { name: "taiko_naito",          isHidden: true },
    { name: "rikishi_naito",        isHidden: true },
    { name: "shar_naito",           isHidden: true },
    { name: "dark_naito_walking",   isHidden: true },
    { name: "akai",                 isHidden: true, format: "png" },

    // toorimasu
    { name: "bif_alien",    isHidden: true, format: "png" },
    { name: "bif_wizard",   isHidden: true, format: "png" },

    // other
    { name: "himawari",     isHidden: true },
    { name: "youkanman",    isHidden: true },
    { name: "ika",          isHidden: true },
    { name: "goatse",       isEvent:  true, isHidden: true, format: "png"},
    { name: "habbo",        isHidden: true, format: "png"},
    { name: "takenoko",     isHidden: true },

]

export const characters: { [characterId: string]: Character } =
    Object.fromEntries(characterObjects.map(o => [o.name, new Character(o)]))

export const loadCharacters = async (crispMode: boolean) => {

    const response = await fetch("/api/characters/" + (crispMode ? "crisp" : "regular") + "?v=" + (window as any).EXPECTED_SERVER_VERSION)
    const dto = await response.json()
    
    Object.keys(characters).forEach(characterId => characters[characterId].setDto(dto[characterId]))
}