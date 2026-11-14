import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * Keeps the rest of the page alive when the globe cannot start. MapLibre throws while mounting when the
 * browser has no WebGL2 (GPU disabled, some remote desktops and locked-down machines); without this
 * boundary React unmounts the whole app and the page goes blank.
 */
export class GlobeBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <h1>Hotspot Harmony</h1>
        <p className="notice" role="status">
          The 3D globe needs WebGL2, which this browser does not offer. The burning activity calendar below works
          without it.
        </p>
      </div>
    );
  }
}
