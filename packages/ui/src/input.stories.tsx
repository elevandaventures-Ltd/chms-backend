import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./input.js";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    name: "example",
    placeholder: "Type something…",
  },
};

export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {};

export const WithLabel: Story = {
  args: {
    label: "Email address",
    type: "email",
    placeholder: "you@example.com",
  },
};

export const WithError: Story = {
  args: {
    label: "Password",
    type: "password",
    error: "Password must be at least 8 characters",
    defaultValue: "abc",
  },
};

export const Disabled: Story = {
  args: {
    label: "Username",
    disabled: true,
    defaultValue: "readonly-user",
  },
};
