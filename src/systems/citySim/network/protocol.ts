export type NetVec3 = { x: number; y: number; z: number };

export type NetworkEntitySnapshot = {
  id: string;
  displayName: string;
  role: string;
  mood: string;
  position: NetVec3;
  rotation: number;
  currentAction: string;
  controlledBy: "ai" | "human" | "network";
};

export type NetworkDialogueLine = {
  id: string;
  at: number;
  speakerId: string;
  speakerName: string;
  text: string;
};

export type HostWorldSnapshot = {
  tick: number;
  entities: NetworkEntitySnapshot[];
  dialogueTail: NetworkDialogueLine[];
};

export type HubClientToServer =
  | {
      type: "register";
      role: "host";
      displayName?: string;
    }
  | {
      type: "register";
      role: "client";
      displayName?: string;
    }
  | {
      type: "ping";
      at: number;
    }
  | {
      type: "clientPose";
      position: NetVec3;
      rotationY: number;
      moveX?: number;
      moveZ?: number;
      sprint?: boolean;
    }
  | {
      type: "clientChat";
      text: string;
    }
  | {
      type: "hostSnapshot";
      snapshot: HostWorldSnapshot;
    };

export type HubServerToClient =
  | {
      type: "welcome";
      clientId: string;
      hostOnline: boolean;
    }
  | {
      type: "hostStatus";
      online: boolean;
    }
  | {
      type: "hostToClientSnapshot";
      snapshot: HostWorldSnapshot;
    }
  | {
      type: "clientJoined";
      clientId: string;
      displayName: string;
    }
  | {
      type: "clientLeft";
      clientId: string;
    }
  | {
      type: "clientToHostPose";
      clientId: string;
      position: NetVec3;
      rotationY: number;
      moveX?: number;
      moveZ?: number;
      sprint?: boolean;
    }
  | {
      type: "clientToHostChat";
      clientId: string;
      text: string;
    }
  | {
      type: "error";
      message: string;
    };

