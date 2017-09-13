import { ImgSpyWindow }     from "../img-spy-window";
import { IMG_SCAN_MENU }    from "./menu";


const DEFAULT_OPTIONS = {
    width: 800,
    height: 800,
    show: false
};

interface CaseWindowArgs {
    folder: string;
}

export class CaseWindow extends ImgSpyWindow<CaseWindowArgs> {

    constructor(folder: string, options?: Electron.BrowserWindowConstructorOptions) {
        const newOptions = Object.assign({}, options, DEFAULT_OPTIONS);
        super("case", newOptions);
        this.args = { folder };

        this.setMenu(IMG_SCAN_MENU);
    }
}
