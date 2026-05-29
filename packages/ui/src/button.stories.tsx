import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button.js";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    appName: "web",
    children: "Click me",
  },
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Default: Story = {};

export const WithCustomLabel: Story = {
  args: {
    children: "Save changes",
  },
};

export const Styled: Story = {
  args: {
    className: "primary",
    children: "Primary action",
  },
};
