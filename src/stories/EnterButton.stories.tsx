import type { Meta, StoryObj } from "@storybook/react";
import { ArrowRight } from "lucide-react";
import { EnterButton } from "../ui/EnterButton";

const meta: Meta<typeof EnterButton> = {
  title: "Components/EnterButton",
  component: EnterButton,
  tags: ["autodocs"],
  argTypes: {
    label: { control: "text" },
    icon: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof EnterButton>;

export const Default: Story = {
  args: {
    label: "Label",
    onClick: () => {},
  },
};

export const WithIcon: Story = {
  args: {
    label: "Enter",
    icon: <ArrowRight size={12} />,
    onClick: () => {},
  },
};

export const CustomLabel: Story = {
  args: {
    label: "Submit",
    icon: <ArrowRight size={12} />,
    onClick: () => {},
  },
};
