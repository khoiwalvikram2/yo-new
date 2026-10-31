import React from "react";
import { BetList } from "./BetList";

interface BetListTabProps {
  didAnimate: boolean;
}

export const BetListTab: React.FC<BetListTabProps> = (props) => {
  void props;
  return (
    <>
      <BetList />
    </>
  );
};

