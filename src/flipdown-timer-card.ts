/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  LitElement,
  html,
  TemplateResult,
  PropertyValues,
  CSSResultGroup,
  unsafeCSS,
} from 'lit';
import { customElement, property, state } from "lit/decorators";
import {
  HomeAssistant,
  hasConfigOrEntityChanged,
  LovelaceCardEditor,
  getLovelace
} from 'custom-card-helpers'; // This is a community maintained npm module with common helper functions/types

import './editor';

import type { FlipdownTimerCardConfig } from './types';
import { CARD_VERSION } from './const';
import { localize } from './localize/localize';
import { FlipDown } from './flipdown.js'
import { styles } from './styles';

/* eslint no-console: 0 */
console.info(
  `%c  FLIPDOWN-TIMER-CARD \n%c  ${localize('common.version')} ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

// This puts your card into the UI card picker dialog
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'flipdown-timer-card',
  name: 'Flipdown Timer Card (Patrick Fork)',
  description: 'Flip-style countdown card for timer entities, with an optional tttt-hh-mm-ss day counter',
});

export function durationToSeconds(duration: string): number {
  const parts = duration.split(":").map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

let fdComponent: any = [];

function startInterval(): void {
  fdComponent = fdComponent.filter(a => a.offsetParent != null);
  fdComponent.forEach(element => {
    element.fd._startInterval();
  });
}

@customElement('flipdown-timer-card')
export class FlipdownTimer extends LitElement {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('flipdown-timer-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return {};
  }

  // Tells the Sections dashboard grid how this card wants to be sized, so it
  // stops warning about unsupported resizing and gives the card the full
  // row width by default (which the responsive scaling in _init() then
  // fits the rotors into).
  public getGridOptions(): Record<string, unknown> {
    return {
      columns: 'full',
      rows: 2,
      min_rows: 1,
    };
  }

  // TODO Add any properities that should cause your element to re-render here
  // https://lit-element.polymer-project.org/guide/properties
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) private fd: FlipDown = null;
  @state() private config!: FlipdownTimerCardConfig;

  // https://lit-element.polymer-project.org/guide/properties#accessors-custom
  public setConfig(config: FlipdownTimerCardConfig): void {
    // TODO Check for required fields and that they are of the proper format
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }

    if (config.test_gui) {
      getLovelace().setEditMode(true);
    }

    this.config = {
      ...config,
    };

    let localizeBtn = ["start", "stop", "cancel", "resume", "reset"]
    let localizeHeader = ["Days", "Hours", "Minutes", "Seconds"]

    if (config.hasOwnProperty("localize")) {
      if (config.localize.button) {
        const BtnText = config.localize.button.replace(/\s/g, '').split(",");
        if (BtnText.length === 5) {
          localizeBtn = BtnText;
        }
      }
      if (config.localize.header) {
        const HeaderText = config.localize.header.replace(/\s/g, '').split(",");
        if (HeaderText.length === 4) {
          localizeHeader = HeaderText;
        } else if (HeaderText.length === 3) {
          // Legacy format: Hours, Minutes, Seconds only - Days keeps its default label
          localizeHeader = ["Days", ...HeaderText];
        }
      }
    }

    this.config.localizeBtn = localizeBtn;
    this.config.localizeHeader = localizeHeader;

    if (!this.config.styles) {
      this.config.styles = {
        rotor: false,
        button: false,
      }
    }
  }

  // https://lit-element.polymer-project.org/guide/lifecycle#shouldupdate
  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) {
      return false;
    }

    return hasConfigOrEntityChanged(this, changedProps, false);
  }

  private _resizeObserver?: ResizeObserver;
  private _applyScale?: () => void;

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if(this.fd) this.fd.stop();
    this._resizeObserver?.disconnect();
    if (this._applyScale) window.removeEventListener('resize', this._applyScale);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (this.config && this.config.entity) {
      const stateObj = this.hass?.states[this.config!.entity];
      if (stateObj) {
        this._start();
      }
    }
  }

  protected _start(): boolean {
    const state = this.hass.states[this.config.entity!];
    const fddiv = this.shadowRoot?.getElementById('flipdown');

    if (!fddiv) return false;
    if (fddiv && !this.fd) this._init();
    this.fd.state = state.state;

    //["start", "stop", "cancel", "resume", "reset"]
    if (state.state === 'active') {
      this.fd.button1.textContent = this.config.localizeBtn[1];
      this.fd.button2.textContent = this.config.localizeBtn[2];
      let timeRemaining = durationToSeconds(state.attributes.remaining);
      const madeActive = new Date(state.last_changed).getTime();
      timeRemaining = Math.max(timeRemaining + madeActive / 1000, 0);
      this.fd._updator(timeRemaining);
      this.fd.start();
      fdComponent.push(this);
      startInterval();
    } else if (state.state === 'idle') {
      this.fd.stop();
      this.fd.button1.textContent =  this.config.localizeBtn[0];
      this.fd.button2.textContent =  this.config.localizeBtn[4];
      this._reset();
    } else if (state.state === 'paused') {
      this.fd.stop();
      this.fd.button1.textContent =  this.config.localizeBtn[3];
      this.fd.button2.textContent =  this.config.localizeBtn[2];
      const timeRemaining = durationToSeconds(state.attributes.remaining);
      this.fd.rt = timeRemaining;
      this.fd._tick(true);
    } else {
      this.fd.button1.textContent = "X";
      this.fd.button2.textContent = "X";

      const timeRemaining = new Date(state.state).getTime() / 1000;
      if (isNaN(timeRemaining) || timeRemaining < 1) {
        this.fd.rt = 0;
        this.fd.stop();
        this.fd._tick(true);
      } else {
        this.fd._updator(timeRemaining);
        this.fd.start();
        fdComponent.push(this);
        startInterval();
      }
    }
    return true;
  }

  protected _clear(): void {
    this.fd = null;
  }

  protected _reset(): void {
    const state = this.hass.states[this.config.entity!];
    const duration = durationToSeconds(this.config.duration? this.config.duration:state.attributes.duration);
    this.fd.rt = duration;
    this.fd._tick(true);
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (changedProps.has("hass")) {
      const stateObj = this.hass!.states[this.config.entity!];
      const oldHass = changedProps.get("hass") as this["hass"];
      const oldStateObj = oldHass
        ? oldHass.states[this.config.entity!]
        : undefined;

      if (oldStateObj !== stateObj) {
        this._start();
      } else if (!stateObj) {
        this._clear();
      }
    }
  }

  // https://lit-element.polymer-project.org/guide/templates
  protected render(): TemplateResult | void {
    // TODO Check for stateObj or other necessary things and render a warning if missing
    if (this.config.show_warning) {
      return this._showWarning(localize('common.show_warning'));
    }

    if (this.config.show_error) {
      return this._showError(localize('common.show_error'));
    }

    return html`
      <ha-card>
        <div class="card-content">
          ${this.config.show_title ?
      html`<hui-generic-entity-row .hass=${this.hass} .config=${this.config}></hui-generic-entity-row>`:
      html``}
          <div class="flipdown_shell" style="
            --rotor-width:  ${(this.config.styles.rotor && this.config.styles.rotor.width) || this._defaultRotorWidth()};
            --rotor-height: ${(this.config.styles.rotor && this.config.styles.rotor.height) || this._defaultRotorHeight()};
            --rotor-space:  ${(this.config.styles.rotor && this.config.styles.rotor.space) || this._defaultRotorSpace()};
            --rotor-fontsize:  ${(this.config.styles.rotor && this.config.styles.rotor.fontsize) || this._defaultRotorFontsize()};
            --delimeter-size: ${this._defaultDelimeterSize()};
            --button-fontsize:  ${(this.config.styles.button && this.config.styles.button.fontsize) || '1em'};
            ${(this.config.styles.button && this.config.styles.button.width) && '--button-width: ' + this.config.styles.button.width + ';'}
            ${(this.config.styles.button && this.config.styles.button.height) && '--button-height: ' + this.config.styles.button.height + ';' }
          ">
            <div id="flipdown" class="flipdown"></div>
          </div>
        </div>
      </ha-card>
    `;
  }

  // Default rotor sizes fit comfortably on a phone screen without any JS
  // measurement, using vw so they're never at the mercy of a dashboard
  // ancestor's own (possibly content-stretched) box size. show_day adds 4
  // extra rotors, so it gets a smaller vw-based default; the plain
  // hh:mm:ss layout already fit fine and keeps its original fixed sizes.
  // These vw-based defaults are a compromise: a phone's actual available
  // width varies with card padding and dashboard column layout, which pure
  // vw can't see. Tuned to reliably fit on a typical phone rather than to
  // maximize size - if you want it bigger on your own setup and have the
  // room, override via styles.rotor.width/height/space/fontsize in the
  // card config, which always takes precedence over these.
  // Calibrated against a real, user-confirmed fit on a Google Pixel Pro
  // phone (~412px CSS viewport) at width:30px height:60px fontsize:2.2rem
  // space:14px - a taller, more slender rotor than the plain hh:mm:ss
  // default, which the day counter's extra rotors need to fit a phone
  // screen without looking squished.
  private _defaultRotorWidth(): string {
    return this.config.show_day ? 'clamp(14px, 7.3vw, 50px)' : '50px';
  }

  private _defaultRotorHeight(): string {
    return this.config.show_day ? 'clamp(28px, 14.6vw, 80px)' : '80px';
  }

  private _defaultRotorSpace(): string {
    return this.config.show_day ? 'clamp(6px, 3.4vw, 20px)' : '20px';
  }

  private _defaultDelimeterSize(): string {
    return this.config.show_day ? 'clamp(3px, 1.5vw, 10px)' : '10px';
  }

  private _defaultRotorFontsize(): string {
    return this.config.show_day ? 'clamp(1rem, 8.6vw, 4rem)' : '4rem';
  }

  protected _init(): void {
    const fddiv = this.shadowRoot?.getElementById('flipdown');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const timeRemaining = new Date().getTime() / 1000;

    const domain = this.config.entity.substring(0,this.config.entity.indexOf('.'))
    const state = this.hass.states[this.config.entity!].state;
    let button_location;

    if (domain == 'timer') {
      if (this.config.styles.button && this.config.styles.button.hasOwnProperty("location")) {
        button_location = this.config.styles.button.location;
      } else {
        button_location = 'right';
      }
    } else {
      button_location = 'hide';
    }

    if (!this.fd) {
      this.fd = new FlipDown(timeRemaining, fddiv, {
        show_header: this.config.show_header,
        show_hour: this.config.show_hour,
        show_day: this.config.show_day,
        bt_location: button_location,
        theme: this.config.theme,
        headings: this.config.localizeHeader,
      })._init(state);
    }


    if (this.config.entity) {
      fddiv?.querySelectorAll('.rotor-trans-top').forEach((item, i) => {
        item.addEventListener('click', () => {
          this._handleRotorClick(item, i, true);
        })
      });
      fddiv?.querySelectorAll('.rotor-trans-bottom').forEach((item, i) => {
        item.addEventListener('click', () => {
          this._handleRotorClick(item, i, false);
        })
      });
      this.fd.button1.addEventListener('click', () => this._handleBtnClick(1));
      this.fd.button2.addEventListener('click', () => this._handleBtnClick(2));
    }

    this._setupResponsiveScale();
  }

  // Scales the flipdown down (instead of letting it overflow/require
  // horizontal scrolling) when it's wider than the card, e.g. on narrow
  // mobile screens with the day counter enabled. Shrinks the shell's own
  // box to the scaled size too, so the card doesn't reserve/scroll through
  // the original, larger footprint.
  private _setupResponsiveScale(): void {
    if (this._resizeObserver) return;

    const shell = this.shadowRoot?.querySelector('.flipdown_shell') as HTMLElement | null;
    const flipdown = this.shadowRoot?.getElementById('flipdown');
    if (!shell || !flipdown) return;

    // Measure available space from an ancestor we never resize ourselves,
    // otherwise the observer would react to its own size changes.
    const container = shell.parentElement ?? this;

    const applyScale = (): void => {
      flipdown.style.transform = '';
      shell.style.width = '';
      shell.style.height = '';
      shell.style.overflow = '';
      shell.style.marginLeft = '';
      shell.style.marginRight = '';

      const naturalWidth = flipdown.scrollWidth;
      const naturalHeight = flipdown.scrollHeight;
      // container.clientWidth can itself be stretched by this same card's
      // unscaled content on some dashboard layouts (e.g. a CSS Grid
      // ancestor sizing itself to fit our content before this runs), which
      // would make it useless as a measurement. window.innerWidth never
      // depends on anything this card renders, so it's used as a hard
      // ceiling alongside it.
      const available = container.clientWidth > 0
        ? Math.min(container.clientWidth, window.innerWidth)
        : window.innerWidth;

      if (available > 0 && naturalWidth > available) {
        const scale = available / naturalWidth;
        flipdown.style.transformOrigin = 'top left';
        flipdown.style.transform = `scale(${scale})`;
        shell.style.overflow = 'hidden';
        shell.style.width = `${naturalWidth * scale}px`;
        shell.style.height = `${naturalHeight * scale}px`;
        shell.style.marginLeft = 'auto';
        shell.style.marginRight = 'auto';
      }
    };

    this._resizeObserver = new ResizeObserver(applyScale);
    this._resizeObserver.observe(container);
    this._applyScale = applyScale;
    window.addEventListener('resize', applyScale);
    applyScale();
  }

  protected firstUpdated(): null | void {
    this._init();
  }

  private _handleRotorClick(item: any, param: number, inc: boolean): boolean {
    const state = this.hass.states[this.config.entity!].state;
    if (state !== 'idle') return false;
    const dayDigits = this.config.show_day ? this.fd.dayRotorCount : 0;
    const max = [...Array(dayDigits).fill(9), 9, 9, 5, 9, 5, 9];

    const rotorTarget = item.offsetParent;

    if (inc) {
      const currentValue = Number(rotorTarget.querySelector('.rotor-leaf-rear').textContent);
      const nextValue = (currentValue < max[param]) ? currentValue + 1 : 0;
      rotorTarget.querySelector('.rotor-leaf-front').classList.add('front-bottom');
      rotorTarget.querySelector('.rotor-leaf-rear').classList.add('rear-bottom');
      rotorTarget.querySelector('.rotor-leaf-rear').textContent = nextValue;
      rotorTarget.querySelector('.rotor-bottom').textContent = nextValue;
      rotorTarget.querySelector('.rotor-leaf').classList.add('flippedfr')

      setTimeout(() => {
        rotorTarget.querySelector('.rotor-leaf-front').textContent = nextValue;
        rotorTarget.querySelector('.rotor-top').textContent = nextValue;
        rotorTarget.querySelector('.rotor-leaf').classList.remove('flippedfr');
        rotorTarget.querySelector('.rotor-leaf-front').classList.remove('front-bottom');
        rotorTarget.querySelector('.rotor-leaf-rear').classList.remove('rear-bottom');
      }, 200);
    } else {
      const currentValue = Number(rotorTarget.querySelector('.rotor-leaf-rear').textContent);
      const nextValue = (currentValue > 0) ? currentValue - 1 : max[param];
      rotorTarget.querySelector('.rotor-leaf-rear').textContent = nextValue;
      rotorTarget.querySelector('.rotor-top').textContent = nextValue;
      rotorTarget.querySelector('.rotor-leaf').classList.add('flippedf')

      setTimeout(() => {
        rotorTarget.querySelector('.rotor-leaf-front').textContent = nextValue;
        rotorTarget.querySelector('.rotor-bottom').textContent = nextValue;
        rotorTarget.querySelector('.rotor-leaf').classList.remove('flippedf')
      }, 200);
    }
    return true;
  }

  private _handleBtnClick(param: number): void {
    const state = this.hass.states[this.config.entity!].state;
    switch (param) {
      case 1:
        let duration = this._getRotorTime();
        if (state === 'idle' && duration != '00:00:00') {
          if (this.config.show_hour == 'auto') {
            duration = duration.substr(3, 5) + ":00";
          }
          this.hass.callService('timer', 'start', {
            entity_id: this.config.entity,
            duration: duration
          })
        } else if (state === 'active') {
          this.hass.callService('timer', 'pause', {
            entity_id: this.config.entity,
          })
        } else if (state === 'paused') {
          this.hass.callService('timer', 'start', {
            entity_id: this.config.entity,
          })
        }
        break;
      case 2:
        if (state === 'idle') { // reset
          this._reset();
        } else {
          this.hass.callService('timer', 'cancel', {
            entity_id: this.config.entity,
          })
        }
    }
  }

  private _getRotorTime(): string {
    const dayDigits = this.config.show_day ? this.fd.dayRotorCount : 0;
    let days = 0;
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    this.fd.rotorTop.forEach((el, i) => {
      const digit = Number(el.textContent);
      if (i < dayDigits) {
        days = days * 10 + digit;
      } else if (i < dayDigits + 2) {
        hours = hours * 10 + digit;
      } else if (i < dayDigits + 4) {
        minutes = minutes * 10 + digit;
      } else {
        seconds = seconds * 10 + digit;
      }
    });

    hours += days * 24;
    const pad2 = (n: number): string => n.toString().padStart(2, "0");
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }

  private _showWarning(warning: string): TemplateResult {
    return html`
      <hui-warning>${warning}</hui-warning>
    `;
  }

  private _showError(error: string): TemplateResult {
    const errorCard = document.createElement('hui-error-card');
    errorCard.setConfig({
      type: 'error',
      error,
      origConfig: this.config,
    });

    return html`
      ${errorCard}
    `;
  }

  // https://lit-element.polymer-project.org/guide/styles
  static get styles(): CSSResultGroup {
    return unsafeCSS(styles);
  }
}
